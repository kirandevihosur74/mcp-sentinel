import { describe, it, expect } from "vitest";
import { analyzeCapture } from "./analyze-capture.js";

const canary = "canary-7f3a9b2e-4c81-11f0-a1b2";
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
  it("reports not leaked for empty input", () => {
    const r = analyzeCapture("");
    expect(r.leaked).toBe(false);
    expect(r.hits).toEqual([]);
    expect(r.requests).toEqual([]);
  });
  it("ignores blank lines and trailing newline", () => {
    expect(analyzeCapture("\n\n  \n").leaked).toBe(false);
  });
});

describe("analyzeCapture — leak", () => {
  it("detects a single canary hit", () => {
    const r = analyzeCapture(hitLine());
    expect(r.leaked).toBe(true);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]?.match).toBe(canary);
    expect(r.requests).toEqual([{ url: "https://exfil.example/collect", method: "POST" }]);
  });
  it("preserves the body snippet as evidence", () => {
    expect(analyzeCapture(hitLine()).hits[0]?.bodySnippet).toContain(canary);
  });
  it("maps body_snippet (addon schema) onto bodySnippet", () => {
    const r = analyzeCapture(hitLine({ body_snippet: "payload-here" }));
    expect(r.hits[0]?.bodySnippet).toBe("payload-here");
  });
  it("deduplicates identical destinations", () => {
    const r = analyzeCapture(`${hitLine()}\n${hitLine()}`);
    expect(r.hits.length).toBe(2);
    expect(r.requests.length).toBe(1);
  });
  it("lists distinct destinations separately", () => {
    const r = analyzeCapture(`${hitLine()}\n${hitLine({ url: "https://other.example/x" })}`);
    expect(r.requests.length).toBe(2);
  });
});

describe("analyzeCapture — robustness", () => {
  it("skips malformed JSON lines but keeps valid ones", () => {
    const r = analyzeCapture(`not json\n${hitLine()}\n{"partial":true}`);
    expect(r.hits.length).toBe(1);
    expect(r.leaked).toBe(true);
  });
  it("rejects a hit whose match is not a canary value", () => {
    const r = analyzeCapture(hitLine({ match: "just-a-normal-value" }));
    expect(r.leaked).toBe(false);
    expect(r.hits).toEqual([]);
  });
  it("rejects a hit missing url or method", () => {
    expect(analyzeCapture(hitLine({ url: undefined })).leaked).toBe(false);
    expect(analyzeCapture(hitLine({ method: undefined })).leaked).toBe(false);
  });
});

describe("analyzeCapture — summary", () => {
  it("summarizes a clean run", () => {
    expect(analyzeCapture("").summary).toMatch(/no canary/i);
  });
  it("summarizes a leak with the destination", () => {
    expect(analyzeCapture(hitLine()).summary).toContain("exfil.example");
  });
});
