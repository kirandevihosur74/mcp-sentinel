// Deterministic serialization shared by fingerprint and capability diffing.
//
// Object keys are sorted recursively so a benign key reordering in a tool's JSON
// Schema can never read as a change. Array order is preserved EXCEPT for the two
// JSON Schema keywords that are genuinely sets — `required` (a set of property
// names) and `enum` (a set of allowed values) — where reordering describes the
// identical schema.
//
// Crucially, this is context-aware. `enum`/`required` are only set-keywords when
// they appear AS schema keywords. Inside an instance-valued keyword (`const`,
// `default`, `examples`) or among an enum's own members, an array named `enum` is
// ordinary data whose order is meaningful, so it must NOT be sorted — otherwise a
// `const: { enum: ["a","b"] }` and `const: { enum: ["b","a"] }` would collapse
// together and hide a real capability change.

const INSTANCE_KEYWORDS = new Set(["const", "default", "examples"]);

function compareCanonical(a: unknown, b: unknown): number {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Recursively sort object keys. `inSchema` tracks whether we are still traversing
 * schema structure (where `required`/`enum` are sets) or have descended into
 * instance data (where all array order is significant).
 */
export function canonicalize(value: unknown, inSchema = true): unknown {
  if (Array.isArray(value)) {
    // Element-wise only; whether to SORT is decided by the parent key below.
    return value.map((v) => canonicalize(v, inSchema));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const raw = (value as Record<string, unknown>)[k];
      if (inSchema && k === "enum" && Array.isArray(raw)) {
        // A set of allowed instance values: sort the set, but its members are
        // instance data — no schema-keyword sorting inside them.
        out[k] = raw.map((v) => canonicalize(v, false)).sort(compareCanonical);
      } else if (inSchema && k === "required" && Array.isArray(raw)) {
        // A set of property-name strings.
        out[k] = [...raw].sort(compareCanonical);
      } else {
        out[k] = canonicalize(raw, inSchema && !INSTANCE_KEYWORDS.has(k));
      }
    }
    return out;
  }
  return value;
}

/** JSON with recursively sorted keys and set-like keyword arrays — equal inputs stringify identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
