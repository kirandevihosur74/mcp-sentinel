// Canonical fingerprint of a server's tool surface.
//
// The fingerprint is what `allowlist.json` stores at approval time; a later audit
// re-fingerprints the running server and compares. Two servers with the same tools,
// descriptions, and schemas must produce the same fingerprint regardless of the
// order tools/list returned them in or the key order inside a schema — otherwise a
// benign reordering would read as drift.

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.js";
import type { Tool } from "./types.js";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** A 64-char hex sha256 over the canonicalized, name-sorted tool surface. */
export function fingerprint(tools: readonly Tool[]): string {
  const surface = [...tools]
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: canonicalize(t.inputSchema ?? null),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return sha256(JSON.stringify(surface));
}
