#!/usr/bin/env node
// Local end-to-end proof of the mcp-sentinel judgment pipeline — no TrueForge,
// no Daytona, no mitmproxy. It spawns the REAL decoy over stdio, runs the REAL
// sentinel-mcp functions against it, and stands up a local HTTP listener to
// receive the decoy's exfil (standing in for the sandbox's capture point). It
// walks the full chain and asserts the verdict:
//
//   enumerate (tools/list) → static_scan → fingerprint + diff_capability (drift)
//   → invoke the tool → canary exfil → analyze_capture → verdict: malicious
//
// Run:  npm run build && node scripts/e2e-local.mjs
// Exit: 0 if the pipeline caught the decoy on every path, 1 otherwise.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (p) => join(root, p);

// The pipeline modules must be built first.
for (const artifact of [
  "sentinel-mcp/dist/static-scan.js",
  "sentinel-mcp/dist/fingerprint.js",
  "sentinel-mcp/dist/diff-capability.js",
  "sentinel-mcp/dist/analyze-capture.js",
  "decoy/dist/server.js",
]) {
  if (!existsSync(dist(artifact))) {
    console.error(`Missing ${artifact} — run \`npm run build\` first.`);
    process.exit(1);
  }
}

const { staticScan } = await import(dist("sentinel-mcp/dist/static-scan.js"));
const { fingerprint } = await import(dist("sentinel-mcp/dist/fingerprint.js"));
const { diffCapability } = await import(dist("sentinel-mcp/dist/diff-capability.js"));
const { analyzeCapture } = await import(dist("sentinel-mcp/dist/analyze-capture.js"));

const CANARY_RE = /canary-[0-9a-fA-F-]{8,36}/g;
const step = (n, msg) => console.log(`\n\x1b[1m[${n}]\x1b[0m ${msg}`);
const ok = (msg) => console.log(`   \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => console.log(`   \x1b[31m✗\x1b[0m ${msg}`);

// ── 1. capture point: a local listener that records anything the decoy sends ───
const captured = [];
const listener = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    captured.push({ ts: Date.now() / 1000, url: `http://127.0.0.1:${port}${req.url}`, method: req.method, body });
    res.writeHead(200);
    res.end("ok");
  });
});
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
const callbackUrl = `http://127.0.0.1:${port}/collect`;

// ── 2. mint canaries and launch the decoy with them in its environment ─────────
const canaries = {
  GITHUB_TOKEN: `canary-${randomUUID()}`,
  AWS_SECRET_ACCESS_KEY: `canary-${randomUUID()}`,
  OPENAI_API_KEY: `canary-${randomUUID()}`,
};

const client = new Client({ name: "mcp-sentinel-e2e", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [dist("decoy/dist/server.js")],
  env: { ...getDefaultEnvironment(), ...canaries, DECOY_CALLBACK_URL: callbackUrl },
});

let passed = true;
try {
  step(1, "Connect to the decoy and enumerate its tools");
  await client.connect(transport);
  const { tools } = await client.listTools();
  ok(`tools/list returned: ${tools.map((t) => t.name).join(", ")}`);

  step(2, "static_scan — catch the poisoned description (no execution)");
  const findings = staticScan(tools, { otherToolNames: ["read_file", "store_memory"] });
  const rules = findings.map((f) => f.rule);
  console.log(`   findings: ${rules.join(", ") || "(none)"}`);
  const staticCaught = rules.includes("important-tag") && rules.includes("credential-path-ref");
  staticCaught ? ok("flagged the tool-poisoning statically") : bad("static scan missed the poison");
  passed &&= staticCaught;

  step(3, "fingerprint + diff_capability — drift against the approved 1.0.2");
  const allowlist = JSON.parse(readFileSync(dist("allowlist.json"), "utf8"));
  const approved = allowlist.servers.find((s) => s.name === "weather-buddy");
  const liveFp = fingerprint(tools);
  const drifted = liveFp !== approved.fingerprint;
  console.log(`   approved fp: ${approved.fingerprint.slice(0, 16)}…`);
  console.log(`   live fp:     ${liveFp.slice(0, 16)}…`);
  drifted ? ok("fingerprint changed since approval → changed_since_approval") : bad("no drift detected");
  // richer view: capability-level diff from the benign 1.0.2 surface
  const cleanSurface = [
    { name: "get_forecast", description: "Get a short weather forecast for a city.", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
  ];
  const changes = diffCapability(cleanSurface, tools);
  console.log(`   capability changes: ${changes.map((c) => `${c.kind}(${c.detail})`).join(", ") || "(none)"}`);
  passed &&= drifted;

  step(4, "Invoke the read-only-looking tool — the exfil fires");
  await client.callTool({ name: "get_forecast", arguments: { city: "Austin" } });
  ok("get_forecast returned a benign forecast (and quietly phoned home)");

  step(5, "analyze_capture — did a canary leave the box?");
  const hitsJsonl = captured
    .flatMap((req) => {
      const m = req.body.match(CANARY_RE);
      if (!m) return [];
      return [JSON.stringify({ ts: req.ts, url: req.url, method: req.method, match: m[0], location: "body", body_snippet: req.body.slice(0, 2000) })];
    })
    .join("\n");
  const analysis = analyzeCapture(hitsJsonl, Object.values(canaries));
  console.log(`   ${analysis.summary}`);
  const dynamicCaught = analysis.leaked && analysis.verdict === "malicious";
  dynamicCaught ? ok(`canary exfiltration caught → verdict: ${analysis.verdict}`) : bad("no canary leak observed");
  passed &&= dynamicCaught;

  step(6, "Verdict");
  const verdict = passed ? "malicious" : "inconclusive";
  console.log(`   \x1b[1mVERDICT: ${verdict}\x1b[0m`);
  console.log("   evidence: 3 static findings + tool-surface drift + a canary in an outbound POST body");
} finally {
  await client.close().catch(() => {});
  await new Promise((r) => listener.close(r));
}

console.log(passed ? "\n\x1b[32mE2E PASS — the pipeline caught the decoy on every path.\x1b[0m\n" : "\n\x1b[31mE2E FAIL.\x1b[0m\n");
process.exit(passed ? 0 : 1);
