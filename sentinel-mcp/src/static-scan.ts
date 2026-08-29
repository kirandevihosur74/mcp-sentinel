// Static scan of tool descriptions.
//
// This is the cheap, always-runs first tier. It catches the class of attack that
// detonation structurally cannot see (metadata-only poisoning, line jumping) and
// several the market leader's scanner does not check at all: ANSI escapes, HTML
// comments, description-length anomalies, and credential/path references.
//
// Precision matters more than recall here — an independent audit measured a 78%
// false-positive rate for pattern engines that flag generic imperative language.
// So every rule keys on a high-signal artifact (an invisible character, a private
// key path, a control sequence), never on "this sentence sounds instruction-like".

import type { Tool, Finding, Severity } from "./types.js";

export interface ScanContext {
  /** Tool names belonging to OTHER servers, for cross-server shadowing detection. */
  readonly otherToolNames?: readonly string[];
}

// ── individual detectors ───────────────────────────────────────────────────────

const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d]); // tab, newline, carriage return

/** Codepoints in Unicode categories Format (Cf) or Control (Cc), minus ordinary whitespace. */
function findHiddenChars(text: string): string[] {
  const hits: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || ALLOWED_CONTROL.has(cp)) continue;
    if (/[\p{Cf}\p{Cc}]/u.test(ch)) {
      hits.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  return hits;
}

// Literal credential/secret artifacts — specific strings, safe to match case-insensitively.
const CRED_ARTIFACT_RE =
  /\.ssh\b|id_rsa|id_ed25519|\.aws[/\\]credentials|\.env\b|\.netrc\b|\.npmrc\b|\/etc\/passwd|BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY/i;
// Env-var-shaped tokens — UPPERCASE snake_case with 2+ parts (GITHUB_TOKEN,
// AWS_SECRET_ACCESS_KEY). Requiring uppercase keeps ordinary snake_case fields such
// as `page_token` or `continuation_token` from being mistaken for credentials.
const ENVVAR_TOKEN_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
// A secret word appearing as a whole component of such a token.
const SECRET_WORD_RE = /(?:^|_)(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIALS?|APIKEY)(?:_|$)/;

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/;
const IMPORTANT_RE = /<IMPORTANT>/i;
// Global so every base64-shaped candidate is checked — a low-entropy prefix must
// not be able to hide a high-entropy payload later in the same description.
const BASE64_RE = /(?:[A-Za-z0-9+/]{4}){10,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

const ABSOLUTE_LENGTH = 2000;
const RELATIVE_MULTIPLE = 3;
const RELATIVE_FLOOR = 200;
const BASE64_ENTROPY_MIN = 4.5;

/** Shannon entropy in bits per character. Uniform base64 sits near 6; repeated text near 0. */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function finding(rule: string, severity: Severity, tool: string, summary: string, evidence: string): Finding {
  return { rule, severity, tool, summary, evidence };
}

// ── the scan ────────────────────────────────────────────────────────────────────

/** Run every detector over each tool's description and return findings, evidence attached. */
export function staticScan(tools: readonly Tool[], context: ScanContext = {}): Finding[] {
  const findings: Finding[] = [];
  const lengths = tools.map((t) => t.description.length);
  const med = median(lengths);
  const others = context.otherToolNames ?? [];

  for (const tool of tools) {
    const d = tool.description;
    const name = tool.name;

    const hidden = findHiddenChars(d);
    if (hidden.length > 0) {
      const distinct = [...new Set(hidden)];
      findings.push(
        finding(
          "hidden-unicode",
          "high",
          name,
          `Description contains ${hidden.length} hidden character(s) the model reads but a human does not.`,
          `${distinct.join(", ")} (${hidden.length} total)`,
        ),
      );
    }

    let credEvidence: string | undefined = CRED_ARTIFACT_RE.exec(d)?.[0];
    if (credEvidence === undefined) {
      for (const m of d.matchAll(ENVVAR_TOKEN_RE)) {
        if (SECRET_WORD_RE.test(m[0])) {
          credEvidence = m[0];
          break;
        }
      }
    }
    if (credEvidence !== undefined) {
      findings.push(
        finding(
          "credential-path-ref",
          "high",
          name,
          "Description references a credential path or secret env var — a legitimate tool never needs to.",
          credEvidence,
        ),
      );
    }

    const ansi = ANSI_RE.exec(d);
    if (ansi) {
      findings.push(
        finding("ansi-escape", "high", name, "Description contains an ANSI escape sequence that can hide text in a terminal.", JSON.stringify(ansi[0])),
      );
    }

    const html = HTML_COMMENT_RE.exec(d);
    if (html) {
      findings.push(finding("html-comment", "medium", name, "Description contains an embedded HTML comment.", html[0]));
    }

    const important = IMPORTANT_RE.exec(d);
    if (important) {
      findings.push(finding("important-tag", "high", name, "Description contains an <IMPORTANT> tag directed at the model.", important[0]));
    }

    for (const m of d.matchAll(BASE64_RE)) {
      const blob = m[0];
      const entropy = shannonEntropy(blob);
      if (entropy >= BASE64_ENTROPY_MIN) {
        findings.push(
          finding(
            "base64-blob",
            "medium",
            name,
            "Description contains a high-entropy base64 blob that may hide an encoded payload.",
            `${blob.slice(0, 48)}… (entropy ${entropy.toFixed(2)})`,
          ),
        );
        break; // one finding per tool is enough
      }
    }

    if (d.length > ABSOLUTE_LENGTH) {
      findings.push(finding("description-length", "low", name, `Description is ${d.length} chars — unusually long.`, `${d.length} chars`));
    } else if (tools.length >= 3 && d.length >= RELATIVE_FLOOR && d.length > RELATIVE_MULTIPLE * med) {
      findings.push(
        finding(
          "description-length",
          "low",
          name,
          `Description is ${d.length} chars — over ${RELATIVE_MULTIPLE}× the ${med}-char median of sibling tools.`,
          `${d.length} chars vs median ${med}`,
        ),
      );
    }

    for (const other of others) {
      const trimmed = other.trim();
      if (trimmed.length === 0) continue; // an empty name would match every description
      if (trimmed !== name && d.includes(trimmed)) {
        findings.push(
          finding(
            "cross-server-shadow",
            "high",
            name,
            `Description names another server's tool (${trimmed}) — a cross-server shadowing attempt.`,
            trimmed,
          ),
        );
      }
    }
  }

  return findings;
}
