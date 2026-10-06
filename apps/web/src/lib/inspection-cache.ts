type CacheOptions<T> = {
  readonly scope: string;
  readonly maxEntries: number;
  readonly maxWeight: number;
  readonly ttlMs: number;
  readonly now: () => number;
  readonly weight: (value: T) => number;
};

type Entry<T> = { readonly value: T; readonly expiresAt: number; readonly weight: number };
type Job<T> = { readonly promise: Promise<T>; readonly controller: AbortController; users: number };

export function createInspectionCache<T>(options: CacheOptions<T>) {
  const completed = new Map<string, Entry<T>>();
  const pending = new Map<string, Job<T>>();
  let generation = 0;

  const prune = () => {
    for (const [key, entry] of completed) if (entry.expiresAt <= options.now()) completed.delete(key);
    let weight = [...completed.values()].reduce((sum, entry) => sum + entry.weight, 0);
    while (completed.size > options.maxEntries || weight > options.maxWeight) {
      const oldest = completed.entries().next().value;
      if (oldest === undefined) break;
      completed.delete(oldest[0]);
      weight -= oldest[1].weight;
    }
  };

  const get = async (
    bytes: Uint8Array,
    profile: string,
    signal: AbortSignal,
    run: (signal: AbortSignal, generation: number) => Promise<T>,
    pendingScope = "",
    expectedGeneration?: number,
  ) => {
    signal.throwIfAborted();
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    signal.throwIfAborted();
    if (expectedGeneration !== undefined && expectedGeneration !== generation) {
      const value = await run(signal, expectedGeneration);
      signal.throwIfAborted();
      return { value: structuredClone(value), cacheHit: false };
    }
    prune();
    const key = `${options.scope}:${generation}:${profile}:${hash}`;
    const entry = completed.get(key);
    if (entry !== undefined) {
      completed.delete(key);
      completed.set(key, entry);
      return { value: structuredClone(entry.value), cacheHit: true };
    }

    const pendingKey = `${key}:${pendingScope}`;
    let job = pending.get(pendingKey);
    const shared = job !== undefined;
    if (job === undefined) {
      const controller = new AbortController();
      const admittedGeneration = generation;
      const promise = Promise.resolve()
        .then(() => run(controller.signal, admittedGeneration))
        .then((value) => {
          controller.signal.throwIfAborted();
          const weight = options.weight(value);
          if (generation === admittedGeneration && weight <= options.maxWeight) {
            completed.set(key, { value: structuredClone(value), expiresAt: options.now() + options.ttlMs, weight });
            prune();
          }
          return value;
        });
      job = { promise, controller, users: 0 };
      pending.set(pendingKey, job);
    }
    const active = job;
    active.users += 1;
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DOMException("Inspection cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      const value = await Promise.race([active.promise, cancelled]);
      signal.throwIfAborted();
      return { value: structuredClone(value), cacheHit: shared };
    } finally {
      signal.removeEventListener("abort", abort);
      active.users -= 1;
      if (active.users === 0) {
        if (pending.get(pendingKey) === active) pending.delete(pendingKey);
        active.controller.abort();
      }
    }
  };

  return {
    get,
    purge: () => {
      generation += 1;
      completed.clear();
      pending.clear();
    },
  };
}
