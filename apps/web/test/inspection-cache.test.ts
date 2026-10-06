import { describe, expect, it, vi } from "vitest";

import { createInspectionCache } from "../src/lib/inspection-cache";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const BYTES = new Uint8Array([1, 2, 3]);
const signal = () => new AbortController().signal;

function setup(scope = "tab-1", maxEntries = 2, maxWeight = 100) {
  let now = 0;
  const cache = createInspectionCache<{ text: string }>({
    scope,
    maxEntries,
    maxWeight,
    ttlMs: 100,
    now: () => now,
    weight: (value) => value.text.length,
  });
  return {
    cache,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("completed local inspection cache", () => {
  it("reuses exact bytes/profile and returns independent copies", async () => {
    const { cache } = setup();
    const run = vi.fn(() => Promise.resolve({ text: "sanitized" }));
    const first = await cache.get(BYTES, "v1", signal(), run);
    first.value.text = "changed";
    expect(await cache.get(new Uint8Array(BYTES), "v1", signal(), run)).toEqual({
      cacheHit: true,
      value: { text: "sanitized" },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not reuse across content, profile or scope changes", async () => {
    const { cache } = setup();
    const run = vi.fn(() => Promise.resolve({ text: "safe" }));
    await cache.get(BYTES, "v1", signal(), run);
    await cache.get(BYTES, "v2", signal(), run);
    await cache.get(new Uint8Array([1, 2, 4]), "v1", signal(), run);
    await setup("tab-2").cache.get(BYTES, "v1", signal(), run);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("expires completed results and evicts old entries at the count/weight bound", async () => {
    const { cache, advance } = setup("tab", 1, 4);
    const run = vi.fn(() => Promise.resolve({ text: "safe" }));
    await cache.get(BYTES, "v1", signal(), run);
    advance(100);
    expect((await cache.get(BYTES, "v1", signal(), run)).cacheHit).toBe(false);
    await cache.get(BYTES, "v2", signal(), run);
    expect((await cache.get(BYTES, "v1", signal(), run)).cacheHit).toBe(false);
    const large = vi.fn(() => Promise.resolve({ text: "too large" }));
    await cache.get(BYTES, "large", signal(), large);
    await cache.get(BYTES, "large", signal(), large);
    expect(large).toHaveBeenCalledTimes(2);
  });

  it("shares duplicate work while one caller can cancel independently", async () => {
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
    const { cache } = setup();
    const started = deferred<boolean>();
    const finish = deferred<{ text: string }>();
    const run = vi.fn((jobSignal: AbortSignal) => {
      expect(jobSignal.aborted).toBe(false);
      started.resolve(true);
      return finish.promise;
    });
    const controller = new AbortController();
    const first = cache.get(BYTES, "v1", controller.signal, run);
    const firstOutcome = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    const second = cache.get(BYTES, "v1", signal(), run);
    await Promise.resolve();
    controller.abort();
    await firstOutcome;
    finish.resolve({ text: "safe" });
    expect((await second).value.text).toBe("safe");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never caches failure or abandoned work", async () => {
    const { cache } = setup();
    const failed = vi.fn(() => Promise.reject(new Error("inspection failed")));
    await expect(cache.get(BYTES, "v1", signal(), failed)).rejects.toThrow("inspection failed");
    await expect(cache.get(BYTES, "v1", signal(), failed)).rejects.toThrow("inspection failed");
    expect(failed).toHaveBeenCalledTimes(2);
    const started = deferred<AbortSignal>();
    const finish = deferred<{ text: string }>();
    const controller = new AbortController();
    const abandoned = cache.get(BYTES, "v2", controller.signal, (jobSignal) => {
      started.resolve(jobSignal);
      return finish.promise;
    });
    const outcome = expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    const jobSignal = await started.promise;
    controller.abort();
    await outcome;
    expect(jobSignal.aborted).toBe(true);
    finish.resolve({ text: "safe" });
    expect((await cache.get(BYTES, "v2", signal(), () => Promise.resolve({ text: "new" }))).cacheHit).toBe(false);
  });

  it("purging prevents an older in-flight inspection from repopulating the cache", async () => {
    const { cache } = setup();
    const started = deferred<boolean>();
    const finish = deferred<{ text: string }>();
    const run = vi.fn(() => {
      started.resolve(true);
      return finish.promise;
    });
    const pending = cache.get(BYTES, "v1", signal(), run);
    await started.promise;
    cache.purge();
    finish.resolve({ text: "old" });
    await pending;
    expect((await cache.get(BYTES, "v1", signal(), () => Promise.resolve({ text: "new" }))).cacheHit).toBe(false);
  });

  it("does not cache old parent work when purged during child hashing", async () => {
    const { cache } = setup();
    const started = deferred<boolean>();
    const hash = deferred<ArrayBuffer>();
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(BYTES).buffer);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => {
      started.resolve(true);
      return hash.promise;
    });
    const run = vi.fn(() => Promise.resolve({ text: "safe" }));
    const pending = cache.get(BYTES, "v1", signal(), run, "parent", 0);
    await started.promise;
    cache.purge();
    hash.resolve(digest);
    expect((await pending).cacheHit).toBe(false);
    expect((await cache.get(BYTES, "v1", signal(), run)).cacheHit).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
