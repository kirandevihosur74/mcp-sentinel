// Entry point for the sentinel MCP server.
//
// This server exposes mcp-sentinel's *judgment primitives* — static scanning,
// fingerprinting, and capability diffing — as MCP tools. TrueForge's agent calls
// these; all sandbox and network work is driven by the agent through TrueForge's
// own `exec` tool, so every tool here is a pure function over data the agent hands
// it. That keeps this server trivial to unit-test and keeps the harness visibly in
// charge of orchestration.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { z } from "zod";
import { staticScan } from "./static-scan.js";
import { fingerprint } from "./fingerprint.js";
import { diffCapability } from "./diff-capability.js";
import { analyzeCapture } from "./analyze-capture.js";
import type { Tool } from "./types.js";

const ToolShape = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.unknown().optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
});

/** Coerce a validated tool object to the internal Tool type. */
function toTools(raw: z.infer<typeof ToolShape>[]): Tool[] {
  return raw.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}

/** Wrap any JSON-serializable result as an MCP text tool response. */
function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "sentinel", version: "0.1.0" });

  server.registerTool(
    "static_scan",
    {
      description:
        "Statically scan MCP tool descriptions for hidden unicode, credential/path references, ANSI escapes, HTML comments, <IMPORTANT> tags, high-entropy base64, length anomalies, and cross-server shadowing. Returns findings with evidence.",
      inputSchema: z.object({
        tools: z.array(ToolShape),
        otherToolNames: z.array(z.string().min(1)).optional(),
      }),
    },
    ({ tools, otherToolNames }) => jsonResult(staticScan(toTools(tools), { otherToolNames })),
  );

  server.registerTool(
    "fingerprint",
    {
      description:
        "Compute a canonical sha256 fingerprint of a server's tool surface (names, descriptions, schemas). Store this in allowlist.json at approval; compare against it later to detect drift.",
      inputSchema: z.object({ tools: z.array(ToolShape) }),
    },
    ({ tools }) => jsonResult({ fingerprint: fingerprint(toTools(tools)) }),
  );

  server.registerTool(
    "diff_capability",
    {
      description:
        "Diff two tool snapshots at the capability level: added/removed tools, changed input schemas, and newly referenced file paths, credential env vars, or network destinations. Cosmetic rewordings are ignored.",
      inputSchema: z.object({
        before: z.array(ToolShape),
        after: z.array(ToolShape),
      }),
    },
    ({ before, after }) => jsonResult({ changes: diffCapability(toTools(before), toTools(after)) }),
  );

  server.registerTool(
    "analyze_capture",
    {
      description:
        "Analyze a sandbox run's capture log (the contents of canary_hits.jsonl) against the exact canary values the probe minted this run (knownCanaries, from ProbeResult.canaries). Returns whether any of those canaries left the sandbox, the distinct destinations, the captured evidence, and the verdict: `malicious` on any leak (unambiguous exfiltration), else null. Only exact canary matches count, so an audited server cannot fake a leak with its own canary-shaped string.",
      inputSchema: z.object({ hitsJsonl: z.string(), knownCanaries: z.array(z.string()) }),
    },
    ({ hitsJsonl, knownCanaries }) => jsonResult(analyzeCapture(hitsJsonl, knownCanaries)),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
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
    console.error("sentinel-mcp failed to start:", err);
    process.exit(1);
  });
}
