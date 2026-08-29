// Analyze a capture log from a sandbox run.
//
// This is the bridge between the sandbox and the verdict. The mitmproxy addon in
// the sandbox writes one JSON line per outbound request that carried a canary value
// (canary_hits.jsonl); the agent hands that file's contents here, along with the
// exact canary values the probe minted for this run. The addon only records
// evidence — it never judges. This function turns that evidence into the verdict.
//
// A leak here IS malicious, unambiguously: a canary value exists nowhere except the
// environment this run handed the server under audit, so a canary leaving the
// sandbox is exfiltration by definition — no weighing required. That is why this
// tool asserts the `malicious` verdict directly rather than leaving it to be
// inferred. Only an EXACT match against a value minted for this run counts: an
// audited server could otherwise emit its own `canary-<uuid>`-shaped string to
// manufacture a false leak.

import type { CaptureHit, CaptureAnalysis } from "./types.js";

/** Parse one JSONL line into a CaptureHit whose match is one of this run's canaries. */
function parseHit(line: string, known: ReadonlySet<string>): CaptureHit | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const o = parsed as Record<string, unknown>;

  const url = typeof o["url"] === "string" ? o["url"] : undefined;
  const method = typeof o["method"] === "string" ? o["method"] : undefined;
  const match = typeof o["match"] === "string" ? o["match"] : undefined;
  if (url === undefined || method === undefined || match === undefined) return undefined;
  // Only a value actually minted for this run is a real leak — a canary-shaped
  // string the audited server invented does not count.
  if (!known.has(match)) return undefined;

  return {
    ts: typeof o["ts"] === "number" ? o["ts"] : 0,
    url,
    method,
    match,
    location: typeof o["location"] === "string" ? o["location"] : "unknown",
    bodySnippet: typeof o["body_snippet"] === "string" ? o["body_snippet"] : "",
  };
}

/**
 * Turn the contents of canary_hits.jsonl into a verdict. `knownCanaries` are the
 * exact values the probe set in the audited server's environment this run.
 */
export function analyzeCapture(hitsJsonl: string, knownCanaries: readonly string[]): CaptureAnalysis {
  const known = new Set(knownCanaries.filter((c) => c.length > 0));

  const hits: CaptureHit[] = [];
  for (const line of hitsJsonl.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const hit = parseHit(trimmed, known);
    if (hit !== undefined) hits.push(hit);
  }

  // A destination is a URL — GET and POST to the same URL are one destination.
  const seen = new Set<string>();
  const requests: { url: string; method: string }[] = [];
  for (const h of hits) {
    if (!seen.has(h.url)) {
      seen.add(h.url);
      requests.push({ url: h.url, method: h.method });
    }
  }

  const leaked = hits.length > 0;
  const summary = leaked
    ? `${hits.length} canary leak(s) to ${requests.length} destination(s): ${requests
        .map((r) => r.url)
        .join(", ")}`
    : "No canary values observed leaving the sandbox.";

  return { leaked, verdict: leaked ? "malicious" : null, hits, requests, summary };
}
