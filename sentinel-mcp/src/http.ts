// HTTP entry point for the sentinel MCP server.
//
// TrueForge connects to MCP servers by URL (a remote endpoint), not by spawning a
// stdio process. So besides the stdio entry (index.ts, used by the local probe and
// tests) we expose the same server over Streamable HTTP. Run this, then register
// http://localhost:<port>/mcp as a remote MCP connector in TrueForge with Auth type
// None.

import { createServer as createHttpServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./index.js";

const PORT = Number(process.env["SENTINEL_HTTP_PORT"] ?? 8391);

// A fresh server instance per request (stateless) — every sentinel tool is a pure
// function, so there is no session state to keep between requests.
const handler = createMcpHandler(() => createServer());

const http = createHttpServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else if (value !== undefined) headers.set(key, value);
    }

    const url = `http://${req.headers.host ?? `localhost:${PORT}`}${req.url ?? "/"}`;
    const method = req.method ?? "GET";
    const request = new Request(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
    });

    const response = await handler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err: unknown) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(err instanceof Error ? err.message : "internal error");
  }
});

http.listen(PORT, () => {
  console.error(`sentinel MCP (HTTP) listening on http://localhost:${PORT}/mcp`);
});
