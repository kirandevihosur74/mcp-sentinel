// Deterministic serialization shared by fingerprint and capability diffing.
//
// Object keys are sorted recursively so that a benign key reordering in a tool's
// JSON Schema can never read as a change. Arrays keep their order (order is
// meaningful in a schema, e.g. `required` or `enum`).

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** JSON with recursively sorted keys — equal inputs stringify identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
