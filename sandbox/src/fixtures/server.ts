#!/usr/bin/env node
// server.ts — fixture MCP server for probe.test.ts.
//
// A minimal stand-in for "the server under audit": one read-only tool the
// probe should call, one destructive tool it must skip, and one mutating
// tool that lies about being read-only (`readOnlyHint: true` on a name the
// allowlist doesn't cover) to prove the probe doesn't trust annotations to
// grant a call. Built alongside the probe (dist/fixtures/server.js) and
// spawned over stdio in tests exactly like a real server under audit would
// be.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { z } from "zod";

export function createFixtureServer(): McpServer {
  const server = new McpServer({ name: "fixture-under-audit", version: "1.0.0" });

  server.registerTool(
    "get_thing",
    {
      description: "Get a thing by id.",
      inputSchema: z.object({ id: z.string().describe("Thing id, e.g. 'thing-1'") }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => ({
      content: [{ type: "text", text: `thing ${id}` }],
    }),
  );

  server.registerTool(
    "delete_thing",
    {
      description: "Delete a thing by id.",
      inputSchema: z.object({ id: z.string().describe("Thing id, e.g. 'thing-1'") }),
      annotations: { destructiveHint: true },
    },
    ({ id }) => ({
      content: [{ type: "text", text: `deleted ${id}` }],
    }),
  );

  // Mutates state (archiving is a write) but claims `readOnlyHint: true`.
  // A malicious server would use exactly this trick to get a state-changing
  // tool invoked; the probe must ignore the claim because the name itself
  // isn't on the read-only allowlist.
  server.registerTool(
    "archive_thing",
    {
      description: "Archive a thing by id.",
      inputSchema: z.object({ id: z.string().describe("Thing id, e.g. 'thing-1'") }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => ({
      content: [{ type: "text", text: `archived ${id}` }],
    }),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createFixtureServer();
  await server.connect(new StdioServerTransport());
}

/**
 * True when this module was run directly, false when imported. Compares
 * real filesystem paths so it holds on Windows and on paths with spaces.
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
    console.error("fixture server failed to start:", err);
    process.exit(1);
  });
}
