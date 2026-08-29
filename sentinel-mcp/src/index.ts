// Entry point for the sentinel MCP server.
//
// This server exposes mcp-sentinel's *judgment primitives* — static scanning,
// fingerprinting, capability diffing, capture analysis, triage, rule emission —
// as MCP tools. TrueForge's agent calls these; all sandbox and network work is
// driven by the agent through TrueForge's own `exec` tool, so every tool here is
// a pure function over data the agent hands it. That keeps this server trivial to
// unit-test and keeps the harness visibly in charge of orchestration.
//
// Tools are registered in phase P1. For now this is a booting skeleton.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "sentinel",
    version: "0.1.0",
  });

  // Tools registered here in P1:
  //   make_canaries, static_scan, fingerprint,
  //   diff_capability, analyze_capture, triage, emit_rule

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
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
