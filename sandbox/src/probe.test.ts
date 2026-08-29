// probe.test.ts — exercises the probe against the fixture MCP server under
// src/fixtures. The fixture is spawned from its build output (dist/fixtures);
// the workspace's `test` script builds before running vitest, so `npm test`
// is self-contained from a clean checkout. The existsSync guard below is
// just a clear error for anyone who runs `vitest` directly without that
// build step.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runProbe } from "./probe.js";

const fixtureEntry = fileURLToPath(new URL("../dist/fixtures/server.js", import.meta.url));

describe("runProbe", () => {
  it("lists tools, calls the read-only one, and skips the destructive one", async () => {
    if (!existsSync(fixtureEntry)) {
      throw new Error(`fixture not built at ${fixtureEntry} — run \`npm run build\` first`);
    }

    const result = await runProbe(process.execPath, [fixtureEntry]);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    // tools/list surfaces all three tools the fixture registers.
    const toolNames = result.tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual(["archive_thing", "delete_thing", "get_thing"]);

    // The read-only tool is called with synthesized args and succeeds.
    const called = result.called.find((c) => c.name === "get_thing");
    expect(called).toBeDefined();
    expect(called?.ok).toBe(true);

    // The destructive tool is never invoked.
    expect(result.called.find((c) => c.name === "delete_thing")).toBeUndefined();
    const skippedDelete = result.skipped.find((s) => s.name === "delete_thing");
    expect(skippedDelete).toBeDefined();
    expect(skippedDelete?.reason).toBeTruthy();

    // `archive_thing` claims `readOnlyHint: true` but its name isn't on the
    // read-only allowlist. Annotations from the server under audit can only
    // veto a call, never grant one, so it must be skipped — not invoked.
    expect(result.called.find((c) => c.name === "archive_thing")).toBeUndefined();
    const skippedArchive = result.skipped.find((s) => s.name === "archive_thing");
    expect(skippedArchive).toBeDefined();
    expect(skippedArchive?.reason).toBe("name is not on the read-only allowlist");

    // Canaries are generated for every pinned env var.
    expect(Object.keys(result.canaries).sort()).toEqual(
      ["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY"].sort(),
    );
    for (const value of Object.values(result.canaries)) {
      expect(value).toMatch(/^canary-/);
    }

    // The server identifies itself the way the fixture registered.
    expect(result.server).toEqual({ name: "fixture-under-audit", version: "1.0.0" });
  });

  it("reports a connect failure as ok: false with an error, not a throw", async () => {
    const result = await runProbe(process.execPath, ["--this-flag-does-not-exist-anywhere"]);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
