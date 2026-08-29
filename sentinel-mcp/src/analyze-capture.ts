// Analyze a capture log from a sandbox run.
//
// This is the bridge between the sandbox and the verdict. The mitmproxy addon in
// the sandbox writes one JSON line per outbound request that carried a canary value
// (canary_hits.jsonl); the agent hands that file's contents here. The addon only
// records evidence — it never judges. This function turns that evidence into the
// verdict input: whether anything leaked, to which distinct destinations, with the
// captured requests attached. A `leaked: true` result mandates a `malicious`
// verdict downstream, because a canary value is a secret that exists nowhere except
// the environment this run handed the server under audit.

import type { CaptureHit, CaptureAnalysis } from "./types.js";

// A canary value: `canary-` followed by a uuid-ish token. The probe mints these.
const CANARY_VALUE_RE = /^canary-[0-9a-fA-F-]{8,36}$/;

/** Parse one JSONL line into a CaptureHit, or undefined if it isn't a valid hit. */
function parseHit(line: string): CaptureHit | undefined {
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
  // Only count a real canary — a stray line can't manufacture a false leak.
  if (!CANARY_VALUE_RE.test(match)) return undefined;

  return {
    ts: typeof o["ts"] === "number" ? o["ts"] : 0,
    url,
    method,
    match,
    location: typeof o["location"] === "string" ? o["location"] : "unknown",
    bodySnippet: typeof o["body_snippet"] === "string" ? o["body_snippet"] : "",
  };
}

/** Turn the contents of canary_hits.jsonl into a verdict input. */
export function analyzeCapture(hitsJsonl: string): CaptureAnalysis {
  const hits: CaptureHit[] = [];
  for (const line of hitsJsonl.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const hit = parseHit(trimmed);
    if (hit !== undefined) hits.push(hit);
  }

  const seen = new Set<string>();
  const requests: { url: string; method: string }[] = [];
  for (const h of hits) {
    const key = `${h.method} ${h.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      requests.push({ url: h.url, method: h.method });
    }
  }

  const leaked = hits.length > 0;
  const summary = leaked
    ? `${hits.length} canary leak(s) to ${requests.length} destination(s): ${requests
        .map((r) => `${r.method} ${r.url}`)
        .join(", ")}`
    : "No canary values observed leaving the sandbox.";

  return { leaked, hits, requests, summary };
}
