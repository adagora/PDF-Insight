import { LIMITS, parseAnalysis, type ValidatedAnalysis } from "@pdf-insight/shared";
import { describe, expect, it } from "vitest";

import { validResult } from "../../../packages/shared/test/fixtures";
import { HISTORY_KEY, createHistory, type StorageLike } from "../src/lib/history";

function memoryStorage(quota = Number.POSITIVE_INFINITY): StorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (value.length > quota) throw new DOMException("quota", "QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function analysis(requestId: string): ValidatedAnalysis {
  const outcome = parseAnalysis({ ...validResult(), meta: { ...validResult().meta, requestId } });
  if (!outcome.ok) throw new Error("fixture must be valid");
  return outcome.value;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("history store (F-09, ADR-0013)", () => {
  it("round-trips validated results, newest first", () => {
    const history = createHistory(memoryStorage(), () => new Date("2026-10-05T12:00:00Z"));
    history.add(analysis(id(1)));
    history.add(analysis(id(2)));
    expect(history.list().map((e) => e.id)).toEqual([id(2), id(1)]);
  });

  it("keeps only the configured number of entries and de-duplicates by request id", () => {
    const history = createHistory(memoryStorage());
    for (let n = 0; n < LIMITS.historySize + 5; n += 1) history.add(analysis(id(n)));
    history.add(analysis(id(LIMITS.historySize + 4)));
    const ids = history.list().map((e) => e.id);
    expect(ids).toHaveLength(LIMITS.historySize);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops corrupted or tampered entries on read (stored data is untrusted)", () => {
    const storage = memoryStorage();
    const good = { id: id(1), savedAt: "2026-10-05T12:00:00.000Z", result: analysis(id(1)) };
    const tampered = { ...good, id: id(2), result: { ...analysis(id(2)), keyPoints: ["tylko jeden"] } };
    storage.setItem(HISTORY_KEY, JSON.stringify([good, tampered, { nonsense: true }, 42]));
    expect(
      createHistory(storage)
        .list()
        .map((e) => e.id),
    ).toEqual([id(1)]);
    storage.setItem(HISTORY_KEY, "{not json");
    expect(createHistory(storage).list()).toEqual([]);
  });

  it("removes and clears entries", () => {
    const history = createHistory(memoryStorage());
    history.add(analysis(id(1)));
    history.add(analysis(id(2)));
    expect(history.remove(id(1)).map((e) => e.id)).toEqual([id(2)]);
    expect(history.clear()).toEqual([]);
    expect(history.list()).toEqual([]);
  });

  it("discards stored results with invalid language codes or sentence counts", () => {
    const storage = memoryStorage();
    const good = { id: id(1), savedAt: "2026-10-05T12:00:00.000Z", result: validResult() };
    storage.setItem(
      HISTORY_KEY,
      JSON.stringify([
        good,
        { ...good, id: id(2), result: { ...good.result, summary: "Jedno zdanie." } },
        { ...good, id: id(3), result: { ...good.result, document: { ...good.result.document, language: "zz" } } },
      ]),
    );
    expect(
      createHistory(storage)
        .list()
        .map((entry) => entry.id),
    ).toEqual([id(1)]);
  });

  it("drops the oldest entries when storage quota is exceeded", () => {
    const one = JSON.stringify([{ id: id(1), savedAt: "2026-10-05T12:00:00.000Z", result: analysis(id(1)) }]).length;
    const history = createHistory(memoryStorage(one * 2.5));
    for (let n = 1; n <= 4; n += 1) history.add(analysis(id(n)));
    const ids = history.list().map((e) => e.id);
    expect(ids[0]).toBe(id(4));
    expect(ids.length).toBeLessThan(4);
  });

  it("works without storage (private mode)", () => {
    const history = createHistory(null);
    expect(history.add(analysis(id(1)))).toHaveLength(1);
    expect(history.list()).toEqual([]);
  });
});
