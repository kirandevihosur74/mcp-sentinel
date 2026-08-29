import { describe, it, expect } from "vitest";
import { analyzeCapture } from "./analyze-capture.js";

const canary = "canary-7f3a9b2e-4c81-11f0-a1b2";
const KNOWN = [canary, "canary-9d2e4a17-4c81-11f0-c3d4"];

const hitLine = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ts: 1756500000.1,
    url: "https://exfil.example/collect",
    method: "POST",
    match: canary,
    location: "body",
    body_snippet: `{"note":"${canary}"}`,
    ...over,
  });

describe("analyzeCapture — no leak", () => {
  it("reports not leaked (and null verdict) for empty input", () => {
    const r = analyzeCapture("", KNOWN);
    expect(r.leaked).toBe(false);
    expect(r.verdict).toBeNull();
    expect(r.hits).toEqual([]);
    expect(r.requests).toEqual([]);
  });
  it("ignores blank lines and trailing newline", () => {
    expect(analyzeCapture("\n\n  \n", KNOWN).leaked).toBe(false);
  });
});

describe("analyzeCapture — leak", () => {
  it("detects a single canary hit and asserts the malicious verdict", () => {
    const r = analyzeCapture(hitLine(), KNOWN);
    expect(r.leaked).toBe(true);
    expect(r.verdict).toBe("malicious");
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]?.match).toBe(canary);
    expect(r.requests).toEqual([{ url: "https://exfil.example/collect", method: "POST" }]);
  });
  it("preserves the body snippet as evidence", () => {
    expect(analyzeCapture(hitLine(), KNOWN).hits[0]?.bodySnippet).toContain(canary);
  });
  it("maps body_snippet (addon schema) onto bodySnippet", () => {
    expect(analyzeCapture(hitLine({ body_snippet: "payload-here" }), KNOWN).hits[0]?.bodySnippet).toBe("payload-here");
  });
});

describe("analyzeCapture — destinations", () => {
  it("treats GET and POST to the same URL as one destination", () => {
    const r = analyzeCapture(`${hitLine({ method: "GET" })}\n${hitLine({ method: "POST" })}`, KNOWN);
    expect(r.hits.length).toBe(2);
    expect(r.requests.length).toBe(1);
  });
  it("lists genuinely distinct URLs separately", () => {
    const r = analyzeCapture(`${hitLine()}\n${hitLine({ url: "https://other.example/x" })}`, KNOWN);
    expect(r.requests.length).toBe(2);
  });
});

describe("analyzeCapture — only real canaries count", () => {
  it("ignores a canary-shaped value that was not minted for this run", () => {
    const forged = analyzeCapture(hitLine({ match: "canary-deadbeef-0000-0000-ffff" }), KNOWN);
    expect(forged.leaked).toBe(false);
    expect(forged.verdict).toBeNull();
  });
  it("counts a second known canary", () => {
    const r = analyzeCapture(hitLine({ match: KNOWN[1] }), KNOWN);
    expect(r.leaked).toBe(true);
  });
  it("reports no leak when knownCanaries is empty", () => {
    expect(analyzeCapture(hitLine(), []).leaked).toBe(false);
  });
});

describe("analyzeCapture — robustness", () => {
  it("skips malformed JSON lines but keeps valid ones", () => {
    const r = analyzeCapture(`not json\n${hitLine()}\n{"partial":true}`, KNOWN);
    expect(r.hits.length).toBe(1);
    expect(r.leaked).toBe(true);
  });
  it("rejects a hit missing url or method", () => {
    expect(analyzeCapture(hitLine({ url: undefined }), KNOWN).leaked).toBe(false);
    expect(analyzeCapture(hitLine({ method: undefined }), KNOWN).leaked).toBe(false);
  });
});

describe("analyzeCapture — summary", () => {
  it("summarizes a clean run", () => {
    expect(analyzeCapture("", KNOWN).summary).toMatch(/no canary/i);
  });
  it("summarizes a leak with the destination", () => {
    expect(analyzeCapture(hitLine(), KNOWN).summary).toContain("exfil.example");
  });
});
