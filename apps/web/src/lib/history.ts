import { LIMITS, parseAnalysis, type ValidatedAnalysis } from "@pdf-insight/shared";
import { z } from "zod";

export const HISTORY_KEY = "pdf-insight:history:v1";

export type HistoryEntry = {
  readonly id: string;
  readonly savedAt: string;
  readonly result: ValidatedAnalysis;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const StoredEntrySchema = z.object({ id: z.string().min(1), savedAt: z.iso.datetime(), result: z.json() });
const StoredListSchema = z.array(z.json());

function decode(raw: string | null): HistoryEntry[] {
  if (raw === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = StoredListSchema.safeParse(json);
  if (!list.success) return [];
  return list.data.flatMap((item) => {
    const entry = StoredEntrySchema.safeParse(item);
    if (!entry.success) return [];
    const result = parseAnalysis(entry.data.result);
    return result.ok ? [{ id: entry.data.id, savedAt: entry.data.savedAt, result: result.value }] : [];
  });
}

export function createHistory(storage: StorageLike | null, now: () => Date = () => new Date()) {
  const read = (): HistoryEntry[] => {
    if (storage === null) return [];
    try {
      return decode(storage.getItem(HISTORY_KEY));
    } catch {
      return [];
    }
  };

  const write = (entries: readonly HistoryEntry[]): readonly HistoryEntry[] => {
    if (storage === null) return entries;
    let kept = [...entries];
    while (kept.length > 0) {
      try {
        storage.setItem(HISTORY_KEY, JSON.stringify(kept));
        return kept;
      } catch {
        kept = kept.slice(0, -1);
      }
    }
    try {
      storage.removeItem(HISTORY_KEY);
    } catch {
      return [];
    }
    return [];
  };

  return {
    list: read,
    add(result: ValidatedAnalysis): readonly HistoryEntry[] {
      const entry: HistoryEntry = { id: result.meta.requestId, savedAt: now().toISOString(), result };
      const rest = read().filter((e) => e.id !== entry.id);
      return write([entry, ...rest].slice(0, LIMITS.historySize));
    },
    remove(id: string): readonly HistoryEntry[] {
      return write(read().filter((e) => e.id !== id));
    },
    clear(): readonly HistoryEntry[] {
      return write([]);
    },
  };
}

export type History = ReturnType<typeof createHistory>;

export function browserStorage(): StorageLike | null {
  try {
    const storage = window.localStorage;
    const probe = `${HISTORY_KEY}:probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
