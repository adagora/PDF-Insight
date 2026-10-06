const MULTIPLIERS: readonly [RegExp, number][] = [
  [/^(tys\.?|tysi[aą]c\p{L}*|thousand|k|tsd\.?)$/iu, 1e3],
  [/^(mln\.?|milion\p{L}*|million\p{L}*|mio\.?|m)$/iu, 1e6],
  [/^(mld\.?|miliard\p{L}*|billion\p{L}*|bn|mrd\.?)$/iu, 1e9],
];

const GROUPED = /\d{1,3}(?:[ \u00A0\u202F.,']\d{3})+(?:[.,]\d{1,4})?(?!\d)/gu;
const PLAIN = /\d+(?:[.,]\d{1,4})?/gu;
const SUFFIX =
  /^\s?(tys\.?|tysi[aą]c\p{L}*|thousand|tsd\.?|mln\.?|milion\p{L}*|million\p{L}*|mio\.?|mld\.?|miliard\p{L}*|billion\p{L}*|bn|mrd\.?|k|m)(?![\p{L}])/iu;

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function interpretNumber(token: string): number[] {
  const compact = token.replace(/[ \u00A0\u202F']/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const readings = new Set<number>();
  const push = (text: string) => {
    const value = Number(text);
    if (Number.isFinite(value)) readings.add(value);
  };

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    push(compact.split(thousands).join("").replace(decimal, "."));
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const groups = compact.split(sep);
    if (groups.length === 2) push(compact.replace(sep, "."));
    if (groups.slice(1).every((group) => group.length === 3)) push(groups.join(""));
  } else {
    push(compact);
  }
  return [...readings];
}

function multiplierFor(suffix: string): number | null {
  for (const [pattern, factor] of MULTIPLIERS) if (pattern.test(suffix)) return factor;
  return null;
}

export function collectNumbers(text: string): Set<number> {
  const cents = new Set<number>();
  const joined = text.replace(/(\d)[ \t]*\n[ \t]*(?=\d)/g, "$1 ");
  for (const source of joined === text ? [text] : [text, joined]) collectInto(source, cents);
  return cents;
}

function collectInto(text: string, cents: Set<number>): void {
  for (const regex of [GROUPED, PLAIN]) {
    for (const match of text.matchAll(regex)) {
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 16);
      const suffix = SUFFIX.exec(after);
      const factor = suffix === null ? null : multiplierFor(suffix[1] ?? "");
      for (const value of interpretNumber(match[0])) {
        cents.add(toCents(value));
        if (factor !== null) cents.add(toCents(value * factor));
      }
    }
  }
}

const MONTHS: readonly (readonly string[])[] = [
  ["stycznia", "styczeń", "styczen", "january", "jan", "januar", "jänner"],
  ["lutego", "luty", "february", "feb", "februar"],
  ["marca", "marzec", "march", "mar", "märz", "marz"],
  ["kwietnia", "kwiecień", "kwiecien", "april", "apr"],
  ["maja", "maj", "may", "mai"],
  ["czerwca", "czerwiec", "june", "jun", "juni"],
  ["lipca", "lipiec", "july", "jul", "juli"],
  ["sierpnia", "sierpień", "sierpien", "august", "aug"],
  ["września", "wrzesień", "wrzesien", "wrzesnia", "september", "sep", "sept"],
  ["października", "październik", "pazdziernik", "pazdziernika", "october", "oct", "oktober", "okt"],
  ["listopada", "listopad", "november", "nov"],
  ["grudnia", "grudzień", "grudzien", "december", "dec", "dezember", "dez"],
];

const MONTH_INDEX = new Map<string, number>(
  MONTHS.flatMap((names, index) => names.map((name): [string, number] => [name, index + 1])),
);
const MONTH_ALTERNATION = [...MONTH_INDEX.keys()].sort((a, b) => b.length - a.length).join("|");

const NUMERIC_DMY = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;
const NUMERIC_YMD = /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/g;
const TEXT_DMY = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_ALTERNATION})\\.?\\s+(\\d{4})\\b`, "giu");
const TEXT_MDY = new RegExp(`\\b(${MONTH_ALTERNATION})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "giu");

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function collectDates(text: string): Set<string> {
  const dates = new Set<string>();
  const add = (value: string | null) => {
    if (value !== null) dates.add(value);
  };
  for (const m of text.matchAll(NUMERIC_DMY)) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    add(iso(y, b, a));
    add(iso(y, a, b));
  }
  for (const m of text.matchAll(NUMERIC_YMD)) add(iso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(TEXT_DMY)) {
    add(iso(Number(m[3]), MONTH_INDEX.get((m[2] ?? "").toLowerCase()) ?? 0, Number(m[1])));
  }
  for (const m of text.matchAll(TEXT_MDY)) {
    add(iso(Number(m[3]), MONTH_INDEX.get((m[1] ?? "").toLowerCase()) ?? 0, Number(m[2])));
  }
  return dates;
}

export type GroundingStatus = "grounded" | "from-scan" | "not-found";

export type GroundingIndex = {
  readonly numbers: ReadonlySet<number>;
  readonly dates: ReadonlySet<string>;
  readonly scanPages: ReadonlySet<number>;
};

export function buildGroundingIndex(text: string, scanPages: Iterable<number>): GroundingIndex {
  return { numbers: collectNumbers(text), dates: collectDates(text), scanPages: new Set(scanPages) };
}

function ungrounded(index: GroundingIndex, page: number | null | undefined): GroundingStatus {
  if (index.scanPages.size === 0) return "not-found";
  if (page !== null && page !== undefined && !index.scanPages.has(page)) return "not-found";
  return "from-scan";
}

export function groundAmount(index: GroundingIndex, value: number, page?: number | null): GroundingStatus {
  return index.numbers.has(toCents(value)) ? "grounded" : ungrounded(index, page);
}

export function groundDate(index: GroundingIndex, date: string, page?: number | null): GroundingStatus {
  return index.dates.has(date) ? "grounded" : ungrounded(index, page);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  return m !== null && iso(Number(m[1]), Number(m[2]), Number(m[3])) === value;
}
