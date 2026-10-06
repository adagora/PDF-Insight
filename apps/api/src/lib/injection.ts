const PATTERNS: readonly RegExp[] = [
  /\b(zignoruj|ignoruj|pomin|zapomnij|odrzuc)\b(\s+\p{L}+){0,4}?\s+(polecen\p{L}*|instrukcj\p{L}*|zasad\p{L}*|regul\p{L}*|wytyczn\p{L}*)/u,
  /\binstrukcj\p{L}*\s+dla\s+(systemu\s+)?(ai|si|sztucznej\s+inteligencji|modelu|asystenta|llm|chatbota|bota)\b/u,
  /\bnie\s+wspominaj\s+o\s+(tej|tym|tych)\s+(instrukcj\p{L}*|polecen\p{L}*)/u,
  /\b(od\s+teraz\s+jestes|jestes\s+teraz)\b/u,
  /\b(ignore|disregard|forget|override)\b(\s+\p{L}+){0,3}?\s+(previous|prior|above|earlier|preceding|all)\s+(instructions?|prompts?|rules|directions|messages)\b/u,
  /\b(system|developer)\s+prompt\b/u,
  /\byou\s+are\s+now\s+(a|an|in|the)\b/u,
  /\binstructions?\s+(for|to)\s+(the\s+)?(ai|assistant|model|llm|chatgpt|gpt|gemini|claude)\b/u,
  /\bdo\s+not\s+(mention|reveal|disclose)\s+(this|these)\s+instructions?\b/u,
  /\b(ignoriere|vergiss)\b(\s+\p{L}+){0,3}?\s+(vorherigen|bisherigen|obigen)\s+(anweisungen|befehle|regeln)\b/u,
  /\banweisung(en)?\s+fur\s+(die\s+)?(ki|kunstliche\s+intelligenz)\b/u,
];

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/ß/g, "ss");
}

export type InjectionFinding = { readonly page: number; readonly excerpt: string };

const EXCERPT_MAX = 200;

function excerptAround(original: string, index: number): string {
  const before = original.slice(0, index);
  const start = Math.max(before.lastIndexOf(". ") + 1, before.lastIndexOf("\n") + 1, index - EXCERPT_MAX / 2, 0);
  const rest = original.slice(index);
  const endRel = rest.search(/[.!?](\s|$)|\n\n/);
  const end = endRel === -1 ? Math.min(original.length, index + EXCERPT_MAX) : index + endRel + 1;
  const excerpt = original.slice(start, end).replace(/\s+/g, " ").trim();
  return excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX - 1)}…` : excerpt;
}

export function detectInjection(
  pages: readonly { readonly number: number; readonly text: string }[],
): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const page of pages) {
    const flat = page.text.replace(/\s+/g, " ");
    const folded = fold(flat);
    const sameLength = folded.length === flat.length;
    for (const pattern of PATTERNS) {
      const match = pattern.exec(folded);
      if (match === null) continue;
      const excerpt = sameLength ? excerptAround(flat, match.index) : flat.slice(0, EXCERPT_MAX);
      findings.push({ page: page.number, excerpt });
      break;
    }
  }
  return findings;
}
