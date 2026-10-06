export type SecretPattern = {
  readonly kind: string;
  readonly regex: RegExp;
};

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    kind: "private-key",
    regex:
      /-----BEGIN (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY(?: BLOCK)?-----[\s\S]{1,12000}?-----END (?:[A-Z0-9]{1,20} ){0,3}PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { kind: "aws-access-key-id", regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { kind: "github-token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/g },
  { kind: "github-token", regex: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g },
  { kind: "gitlab-token", regex: /\bglpat-[A-Za-z0-9_-]{20,64}/g },
  { kind: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { kind: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,255}/g },
  { kind: "openai-api-key", regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,255}/g },
  { kind: "slack-token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,255}/g },
  {
    kind: "slack-webhook",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,200}/g,
  },
  { kind: "stripe-key", regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}\b/g },
  { kind: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "huggingface-token", regex: /\bhf_[A-Za-z0-9]{34,64}\b/g },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{8,4096}\.eyJ[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}/g,
  },
];

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s:/@]{1,100}:[^\s/@]{1,200}@/gi;

declare const redactedBrand: unique symbol;
export type RedactedText = string & { readonly [redactedBrand]: true };

export type RedactionFinding = { readonly kind: string; readonly count: number };

export type RedactionResult = {
  readonly text: RedactedText;
  readonly findings: readonly RedactionFinding[];
};

export function redactSecrets(input: string): RedactionResult {
  const counts = new Map<string, number>();
  const bump = (kind: string) => counts.set(kind, (counts.get(kind) ?? 0) + 1);

  let text = input;
  for (const { kind, regex } of SECRET_PATTERNS) {
    text = text.replace(regex, () => {
      bump(kind);
      return `[REDACTED:${kind}]`;
    });
  }
  text = text.replace(URL_CREDENTIALS, (_match, scheme: string) => {
    bump("url-credentials");
    return `${scheme}[REDACTED:url-credentials]@`;
  });

  const findings = [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  // SAFETY: every SECRET_PATTERNS entry and URL_CREDENTIALS was replaced above; the only RedactedText mint (ADR-0011).
  return { text: text as RedactedText, findings };
}

export type SecretMatch = { readonly kind: string; readonly index: number };

export function findSecrets(input: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, regex } of [...SECRET_PATTERNS, { kind: "url-credentials", regex: URL_CREDENTIALS }]) {
    for (const match of input.matchAll(regex)) {
      if (!match[0].includes("[REDACTED:")) matches.push({ kind, index: match.index });
    }
  }
  return matches;
}
