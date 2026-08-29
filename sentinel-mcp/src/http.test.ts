import { afterEach, describe, expect, it } from "vitest";
import { request, type Server } from "node:http";
import { createSentinelHttpServer, parsePort } from "./http.js";

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function startServer(): Promise<number> {
  server = createSentinelHttpServer();
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTP test server did not bind a TCP port");
  return address.port;
}

async function send(
  port: number,
  options: { readonly host?: string; readonly contentLength?: number; readonly body?: string } = {},
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          host: options.host ?? `127.0.0.1:${port}`,
          "content-type": "application/json",
          ...(options.contentLength === undefined ? {} : { "content-length": options.contentLength }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe("parsePort", () => {
  it("uses 8391 by default", () => expect(parsePort(undefined)).toBe(8391));

  it.each(["", "0", "1.5", "abc", "65536", " 8391"])("rejects invalid port %j", (value) => {
    expect(() => parsePort(value)).toThrow(/between 1 and 65535/);
  });

  it("accepts the valid TCP port range", () => {
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65535);
  });
});

describe("sentinel HTTP boundary", () => {
  it("rejects a non-local Host header", async () => {
    const port = await startServer();
    expect((await send(port, { host: "attacker.example" })).status).toBe(403);
  });

  it("rejects a body larger than 1 MiB while streaming", async () => {
    const port = await startServer();
    const response = await send(port, { body: "x".repeat(1024 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect(response.body).toContain("exceeds 1 MiB");
  });

  it("rejects malformed JSON before invoking MCP", async () => {
    const port = await startServer();
    const response = await send(port, { body: "not-json" });
    expect(response.status).toBe(400);
  });
});
