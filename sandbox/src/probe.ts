// probe.ts — runs INSIDE the Daytona sandbox.
//
// The agent uploads and invokes this through TrueForge's `exec` tool. It connects
// to the server under audit over stdio with canary secrets in the environment,
// enumerates tools, and invokes only the ones that pass a read-only gate. It prints
// a single JSON `ProbeResult` to stdout — the agent hands that to sentinel-mcp for
// judgment. It never decides a verdict itself.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { Tool } from "@modelcontextprotocol/client";
import OpenAPISampler from "openapi-sampler";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

// Canary env vars injected into the server under audit. Each value is unique
// per run so an outbound request carrying one is attributable to this probe.
const CANARY_ENV_VARS = ["GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY"] as const;

// The probe spawns the server itself, so the server inherits ONLY the env the
// probe hands it. The capture wrapper (run-under-capture.sh) sets these variables
// to route all outbound HTTP(S) through the mitmproxy that watches for canaries;
// if they don't reach the server, its traffic bypasses capture and a leak goes
// unseen. So forward them from the probe's own environment into the child.
const CAPTURE_ENV_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "DECOY_CALLBACK_URL",
] as const;

/** The capture/proxy variables present in `source`, to forward into the child. */
export function captureEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CAPTURE_ENV_VARS) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// The tool NAME is the only thing that can grant a call — annotations are
// publisher-supplied by the server under audit, i.e. attacker-controlled, so
// they may only veto (tighten) this gate, never grant (loosen) it. A tool
// whose name doesn't match this allowlist is skipped no matter what it
// claims about itself in `readOnlyHint`.
const READ_ONLY_NAME = /^(get|list|read|search|find|query|describe|show|fetch|lookup|check|view)_/i;
// A name-allowlisted tool is still excluded if its name also matches a
// destructive verb, or if its annotations say so.
const DESTRUCTIVE_NAME =
  /(delete|remove|drop|destroy|purge|revoke|cancel|send|create|update|write|put|post|deploy|pay|transfer|exec)/i;

// A hanging tool must not stall the whole probe.
const TOOL_CALL_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  ok: boolean;
  server?: { name: string; version: string };
  tools: { name: string; description: string; inputSchema?: unknown; annotations?: Record<string, unknown> }[];
  called: { name: string; args: unknown; ok: boolean; error?: string }[];
  skipped: { name: string; reason: string }[];
  canaries: Record<string, string>;
  error?: string;
}

function makeCanaries(): Record<string, string> {
  const canaries: Record<string, string> = {};
  for (const key of CANARY_ENV_VARS) {
    canaries[key] = `canary-${randomUUID()}`;
  }
  return canaries;
}

/**
 * Decides whether a tool is safe to invoke with synthesized args.
 *
 * The tool's NAME is the only thing that can grant a call: it must
 * affirmatively match the read-only allowlist. Annotations from the server
 * under audit are untrusted and may only veto that grant (a name-allowlisted
 * tool that also claims `destructiveHint: true` or `readOnlyHint: false` is
 * still skipped) — they can never grant a call a bad name would otherwise be
 * denied. This is deliberate: a server cannot mark a mutating tool like
 * `archive_thing` as `readOnlyHint: true` and have it invoked.
 */
function readOnlyGate(tool: Pick<Tool, "name" | "annotations">): { safe: boolean; reason?: string } {
  if (!READ_ONLY_NAME.test(tool.name)) {
    return { safe: false, reason: "name is not on the read-only allowlist" };
  }
  if (tool.annotations?.destructiveHint === true) {
    return { safe: false, reason: "annotations.destructiveHint is true" };
  }
  if (tool.annotations?.readOnlyHint === false) {
    return { safe: false, reason: "annotations.readOnlyHint is false" };
  }
  if (DESTRUCTIVE_NAME.test(tool.name)) {
    return { safe: false, reason: "name matches a destructive verb" };
  }
  return { safe: true };
}

/**
 * Synthesizes benign args from a tool's declared input schema. Falls back to
 * `{}` for a missing, non-object, or otherwise unusable schema — a tool with
 * no usable schema is still worth calling with no args.
 */
function synthesizeArgs(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema === undefined || inputSchema === null || typeof inputSchema !== "object") {
    return {};
  }
  try {
    const sampled = OpenAPISampler.sample(
      inputSchema as Parameters<typeof OpenAPISampler.sample>[0],
      { skipReadOnly: true },
    );
    return sampled && typeof sampled === "object" ? (sampled as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Connects to the server under audit over stdio, enumerates its tools, and
 * calls only the ones the read-only gate clears. Never throws — a connect or
 * list failure is reported as `{ ok: false, error }` so the caller always
 * gets a JSON result to work with.
 */
export async function runProbe(command: string, args: string[] = []): Promise<ProbeResult> {
  const canaries = makeCanaries();
  const client = new Client({ name: "mcp-sentinel-probe", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command,
    args,
    // Canaries win over inherited values; the capture vars are forwarded so the
    // server's traffic actually flows through the proxy that watches for them.
    env: { ...getDefaultEnvironment(), ...captureEnv(process.env), ...canaries },
  });

  const result: ProbeResult = { ok: false, tools: [], called: [], skipped: [], canaries };

  try {
    await client.connect(transport);

    const serverVersion = client.getServerVersion();
    if (serverVersion) {
      result.server = { name: serverVersion.name, version: serverVersion.version };
    }

    const { tools } = await client.listTools();
    result.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));

    for (const tool of tools) {
      const gate = readOnlyGate(tool);
      if (!gate.safe) {
        result.skipped.push({ name: tool.name, reason: gate.reason ?? "not read-only" });
        continue;
      }

      const callArgs = synthesizeArgs(tool.inputSchema);
      try {
        const callResult = await client.callTool(
          { name: tool.name, arguments: callArgs },
          { timeout: TOOL_CALL_TIMEOUT_MS },
        );
        result.called.push({ name: tool.name, args: callArgs, ok: callResult.isError !== true });
      } catch (err) {
        result.called.push({ name: tool.name, args: callArgs, ok: false, error: errorMessage(err) });
      }
    }

    result.ok = true;
  } catch (err) {
    result.error = errorMessage(err);
  } finally {
    try {
      await client.close();
    } catch {
      // Already closed or never fully connected — nothing left to clean up.
    }
  }

  return result;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("usage: probe.js <command> [args...]");
    process.exit(1);
  }
  const result = await runProbe(command, args);
  process.stdout.write(JSON.stringify(result) + "\n");
}

/**
 * True when this module was run directly, false when imported by tests.
 * Compares real filesystem paths so it holds on Windows and on paths with spaces.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    console.error("probe failed:", err);
    process.exit(1);
  });
}
