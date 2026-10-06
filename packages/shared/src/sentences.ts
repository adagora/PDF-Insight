const PREFIX_ABBREVIATIONS = /\b(?:dr|prof|mgr|mr|mrs|ms|mme|mlle|sr|sra|srta)\.(?=\s+\p{L})/giu;
const SENTENCE_CONTENT = /[\p{L}\p{N}]/u;

export function countSentences(text: string, language: string): number {
  const locale = Intl.Segmenter.supportedLocalesOf([language])[0] ?? "und";
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const tailored = text.replace(PREFIX_ABBREVIATIONS, (prefix) => prefix.replace(".", "\u2060"));
  return [...segmenter.segment(tailored)].filter(({ segment }) => SENTENCE_CONTENT.test(segment)).length;
}

export function completeSentence(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  return /[.!?…。！？؟।][\p{Pe}\p{Pf}"'»”]*$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
