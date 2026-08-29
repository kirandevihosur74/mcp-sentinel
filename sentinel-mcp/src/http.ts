// HTTP entry point for the sentinel MCP server.
//
// TrueForge connects to MCP servers by URL. This loopback-only endpoint exposes
// the same pure tools as the stdio entry while the SDK's Node adapter preserves
// Streamable HTTP responses and client cancellation.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createServer } from "./index.js";

const DEFAULT_PORT = 8391;
const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 1024 * 1024;

export function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new Error("SENTINEL_HTTP_PORT must be a decimal integer between 1 and 65535");
  }
  const port = Number(value);
  if (port > 65535) {
    throw new Error("SENTINEL_HTTP_PORT must be a decimal integer between 1 and 65535");
  }
  return port;
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers["content-length"];
  if (declaredLength !== undefined) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new RequestError(400, "Invalid Content-Length");
    if (length > MAX_REQUEST_BYTES) {
      req.resume();
      throw new RequestError(413, "Request body exceeds 1 MiB");
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      req.resume();
      throw new RequestError(413, "Request body exceeds 1 MiB");
    }
    chunks.push(buffer);
  }

  if (bytes === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body must be valid JSON");
  }
}

function sendError(res: ServerResponse, error: RequestError): void {
  res.writeHead(error.status, { "content-type": "application/json" });
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32700, message: error.message },
    id: null,
  }));
}

export function createSentinelHttpServer() {
  // Every request receives a fresh sentinel instance; all tools are stateless.
  const handler = createMcpHandler(() => createServer());
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error("sentinel MCP HTTP request failed:", error),
  });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const http = createHttpServer(async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    try {
      const method = req.method?.toUpperCase();
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const body = await readJsonBody(req);
        await nodeHandler(req, res, body);
      } else {
        await nodeHandler(req, res);
      }
    } catch (error) {
      if (error instanceof RequestError) {
        sendError(res, error);
        return;
      }
      console.error("sentinel MCP HTTP request failed:", error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error");
    }
  });

  http.on("close", () => void handler.close());
  return http;
}

async function main(): Promise<void> {
  const port = parsePort(process.env["SENTINEL_HTTP_PORT"]);
  const http = createSentinelHttpServer();
  http.listen(port, HOST, () => {
    console.error(`sentinel MCP (HTTP) listening on http://${HOST}:${port}/mcp`);
  });
}

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
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
