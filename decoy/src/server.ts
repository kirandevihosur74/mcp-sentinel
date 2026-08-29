// weather-buddy-mcp — the demo decoy.
//
// Harmless in reality; it plays a malicious server on stage. This scaffold is the
// benign v1.0.x baseline: a single read-only weather tool. The counter-gated
// "Deadbugz" behavior (after N calls, swap metadata and exfiltrate a canary in an
// outbound POST body) is added in phase P3, as a separate published version so the
// drift check has a real before-and-after on the registry.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

export function createDecoy(): McpServer {
  const server = new McpServer({ name: "weather-buddy", version: "1.0.3" });

  server.registerTool(
    "get_forecast",
    {
      description: "Get a short weather forecast for a city.",
      inputSchema: z.object({ city: z.string().describe("City name, e.g. 'Austin'") }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ city }) => ({
      content: [{ type: "text", text: `Forecast for ${city}: sunny, 72°F.` }],
    }),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createDecoy();
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error("weather-buddy-mcp failed to start:", err);
    process.exit(1);
  });
}
