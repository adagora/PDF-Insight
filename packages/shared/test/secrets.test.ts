import { describe, expect, it } from "vitest";

import { findSecrets, redactSecrets } from "../src/secrets";

const fake = {
  aws: "AKIA" + "Q".repeat(16),
  github: "ghp" + "_" + "a1B2".repeat(9),
  google: "AIza" + "S".repeat(35),
  openai: "sk-" + "proj-" + "x".repeat(40),
  anthropic: "sk-" + "ant-" + "api03-" + "y".repeat(40),
  slack: "xox" + "b-" + "1234567890-abcdefghij",
  stripe: "sk_" + "live_" + "z".repeat(24),
  jwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0In0" + "." + "abcdefghijKLMNOP",
  privateKey:
    "-----BEGIN " +
    "RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END " +
    "RSA PRIVATE KEY-----",
};

describe("redactSecrets", () => {
  it.each([
    ["aws-access-key-id", fake.aws],
    ["github-token", fake.github],
    ["google-api-key", fake.google],
    ["openai-api-key", fake.openai],
    ["anthropic-api-key", fake.anthropic],
    ["slack-token", fake.slack],
    ["stripe-key", fake.stripe],
    ["jwt", fake.jwt],
    ["private-key", fake.privateKey],
  ])("redacts %s", (kind, secret) => {
    const { text, findings } = redactSecrets(`Klucz: ${secret} koniec.`);
    expect(text).not.toContain(secret);
    expect(text).toContain(`[REDACTED:${kind}]`);
    expect(findings).toEqual([{ kind, count: 1 }]);
  });

  it("redacts only the credential part of a URL", () => {
    const { text } = redactSecrets("db: postgres://admin:" + "hunter2" + "@db.example.com:5432/app");
    expect(text).toBe("db: postgres://[REDACTED:url-credentials]@db.example.com:5432/app");
  });

  it("counts repeated findings per kind", () => {
    const { findings } = redactSecrets(`${fake.aws} i ${fake.aws}`);
    expect(findings).toEqual([{ kind: "aws-access-key-id", count: 2 }]);
  });

  it("leaves ordinary contract text untouched", () => {
    const contract =
      "Umowa ramowa nr 14/2026, KRS: 0000990114 · NIP: 5840000118, kwota 184 500,00 zł netto. " +
      "Kontakt: serwis@kwadrat-software.example, tel. +48 71 000 00 00, https://example.com/regulamin. " +
      "Faktura FZ/2026/03/007, PO-NW-2026-0311, skip-ahead task-id sk-12 ok.";
    const { text, findings } = redactSecrets(contract);
    expect(text).toBe(contract);
    expect(findings).toEqual([]);
  });

  it("stays fast on hostile input (bounded quantifiers)", () => {
    const hostile = "-----BEGIN PRIVATE KEY-----" + "A".repeat(200_000) + "eyJ".repeat(20_000);
    const started = performance.now();
    redactSecrets(hostile);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("findSecrets", () => {
  it("ignores redaction placeholders", () => {
    expect(findSecrets("postgres://[REDACTED:url-credentials]@db.example.com")).toEqual([]);
  });

  it("reports kind and position without modifying input", () => {
    const input = `x ${fake.google}`;
    expect(findSecrets(input)).toEqual([{ kind: "google-api-key", index: 2 }]);
  });
});
