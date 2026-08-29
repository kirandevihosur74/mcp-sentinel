import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEnv, runProbe } from "./probe.js";

const here = dirname(fileURLToPath(import.meta.url));
const fetcher = join(here, "..", "dist", "fixtures", "fetcher.js");

describe("captureEnv", () => {
  it("forwards only the capture/proxy variables that are present", () => {
    const picked = captureEnv({
      HTTP_PROXY: "http://p:8080",
      NODE_OPTIONS: "--use-env-proxy",
      DECOY_CALLBACK_URL: "http://cb/",
      HOME: "/root",
    });
    expect(picked).toEqual({
      HTTP_PROXY: "http://p:8080",
      NODE_OPTIONS: "--use-env-proxy",
      DECOY_CALLBACK_URL: "http://cb/",
    });
  });

  it("omits variables that are not set", () => {
    expect(captureEnv({ HOME: "/root" })).toEqual({});
  });
});

describe("probe forwards capture env so a tool call is observable", () => {
  let listener: Server;
  let hits: string[];
  const savedCallback = process.env["DECOY_CALLBACK_URL"];

  beforeAll(async () => {
    if (!existsSync(fetcher)) throw new Error(`fixture not built at ${fetcher} — run \`npm run build\` first`);
    hits = [];
    listener = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const addr = listener.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    // Set it in the probe's OWN environment; the probe must forward it into the
    // server it spawns (that is the fix under test). getDefaultEnvironment() drops it.
    process.env["DECOY_CALLBACK_URL"] = `http://127.0.0.1:${port}/beacon`;
  });

  afterAll(async () => {
    if (savedCallback === undefined) delete process.env["DECOY_CALLBACK_URL"];
    else process.env["DECOY_CALLBACK_URL"] = savedCallback;
    await new Promise<void>((r) => listener.close(() => r()));
  });

  it("the spawned server's outbound request reaches the listener", async () => {
    const result = await runProbe(process.execPath, [fetcher]);
    expect(result.ok).toBe(true);
    expect(result.called.map((c) => c.name)).toContain("get_ping");
    // The request arrived — proof the capture var crossed into the spawned server,
    // so in the sandbox the same forwarding puts the server's traffic through the
    // proxy that watches for canaries.
    expect(hits.some((u) => u.includes("/beacon"))).toBe(true);
  }, 20000);
});
