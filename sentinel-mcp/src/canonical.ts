// Deterministic serialization shared by fingerprint and capability diffing.
//
// Object keys are sorted recursively so a benign key reordering in a tool's JSON
// Schema can never read as a change. Array order is usually meaningful, so it is
// preserved — EXCEPT for JSON Schema keywords that are semantically sets, where
// order carries no meaning. Reordering `required: ["a","b"]` to `["b","a"]`, or an
// `enum`, describes the identical schema; sorting those arrays keeps that from
// showing up as spurious drift.

/** JSON Schema keywords whose array value is a set — order is not significant. */
const SET_KEYWORDS = new Set(["required", "enum"]);

function compareCanonical(a: unknown, b: unknown): number {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Recursively sort object keys. Arrays keep their order unless they are the value
 * of a set-like schema keyword (`key`), in which case their elements are sorted
 * deterministically.
 */
export function canonicalize(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v));
    return key !== undefined && SET_KEYWORDS.has(key) ? [...items].sort(compareCanonical) : items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k], k);
    }
    return out;
  }
  return value;
}

/** JSON with recursively sorted keys and set-like keyword arrays — equal inputs stringify identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
