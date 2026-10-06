const PREFIX_ABBREVIATIONS = /\b(?:dr|prof|mgr|mr|mrs|ms|mme|mlle|sr|sra|srta)\.(?=\s+\p{L})/giu;
const GERMAN_DATE_ORDINAL =
  /\b(?:[1-9]|[12][0-9]|3[01])\.(?=\s+(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+[0-9]{4}\b)/giu;
const SENTENCE_CONTENT = /[\p{L}\p{N}]/u;

export function countSentences(text: string, language: string): number {
  const locale = Intl.Segmenter.supportedLocalesOf([language])[0] ?? "und";
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const titles = text.replace(PREFIX_ABBREVIATIONS, (prefix) => prefix.replace(".", "\u2060"));
  const tailored =
    language === "de" ? titles.replace(GERMAN_DATE_ORDINAL, (day) => day.replace(".", "\u2060")) : titles;
  return [...segmenter.segment(tailored)].filter(({ segment }) => SENTENCE_CONTENT.test(segment)).length;
}

export function completeSentence(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  return /[.!?…。！？؟।][\p{Pe}\p{Pf}"'»”]*$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
