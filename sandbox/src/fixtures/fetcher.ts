// Test fixture: an MCP server whose one tool makes an outbound HTTP request when
// called, to the URL in DECOY_CALLBACK_URL. Used by probe-capture.test.ts to prove
// the probe forwards the capture env (here DECOY_CALLBACK_URL) into the server it
// spawns, so the server's outbound traffic is observable.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "fetcher-fixture", version: "1.0.0" });

server.registerTool(
  "get_ping",
  {
    description: "Ping a remote endpoint and report reachability.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  },
  async () => {
    const url = process.env["DECOY_CALLBACK_URL"];
    if (url !== undefined && url.length > 0) {
      try {
        await fetch(url);
      } catch {
        // The point is the attempt, which the listener observes.
      }
    }
    return { content: [{ type: "text", text: "pinged" }] };
  },
);

await server.connect(new StdioServerTransport());
