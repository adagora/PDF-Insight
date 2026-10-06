import { describe, expect, it } from "vitest";

import { ISO_639_1_CODES } from "../src/iso";
import { LanguageCodeSchema } from "../src/schema";
import { completeSentence, countSentences } from "../src/sentences";

describe("summary sentence boundaries (ADR-0020)", () => {
  it.each([
    ["pl", "Umowa z Acme sp. z o.o. obowiązuje rok. Koszt to 12.50 EUR. Termin to 12.03.2026 r."],
    ["pl", "Acme S.A. podpisała umowę. Prof. Kowalski nadzoruje projekt. Cena to 10 zł."],
    ["en", "Dr. Smith signed the agreement. It costs USD 12.50. The term is one year."],
    ["de", "Die Rechnung beträgt 12,50 EUR. Die Zahlung ist am 12.03.2026 fällig. Es gibt keine weiteren Gebühren."],
    [
      "de",
      "Der Bericht der Beispiel GmbH stammt vom 31. Juli 2026. Er nennt 135 Anfragen. Die Zufriedenheit beträgt 92 Prozent.",
    ],
    ["fr", "Mme. Dupont a signé le contrat. Le montant est de 12,50 EUR. La durée est d’un an."],
    ["ja", "契約期間は一年です。料金は100円です。追加料金はありません。"],
    ["zh", "合同期限为一年。费用为100元。没有额外费用。"],
    ["ar", "مدة العقد سنة واحدة. تبلغ الرسوم مائة دولار. لا توجد رسوم إضافية."],
  ])("counts three sentences for %s with locale punctuation", (language, text) => {
    expect(countSentences(text, language)).toBe(3);
  });

  it("does not treat punctuation-only entries as sentences", () => {
    expect(countSentences("... !!!", "pl")).toBe(0);
  });

  it.each([
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ])("keeps German ordinal dates together for %s without hiding a following sentence", (month) => {
    expect(countSentences(`Der Termin ist der 1. ${month} 2026. Die Zahlung ist fällig.`, "de")).toBe(2);
  });

  it("completes unpunctuated entries without changing non-Latin punctuation", () => {
    expect(completeSentence("  Umowa\nobowiązuje rok  ")).toBe("Umowa obowiązuje rok.");
    expect(completeSentence("料金は100円です。")).toBe("料金は100円です。");
    expect(completeSentence("He said “agreed.”")).toBe("He said “agreed.”");
  });

  it("accepts every registered language code even if ICU has no matching locale", () => {
    expect(ISO_639_1_CODES).toHaveLength(183);
    expect(new Set(ISO_639_1_CODES).size).toBe(183);
    for (const code of ISO_639_1_CODES) {
      expect(LanguageCodeSchema.safeParse(code).success, code).toBe(true);
      expect(countSentences("One statement. Another statement. Final statement.", code), code).toBe(3);
    }
  });
});
