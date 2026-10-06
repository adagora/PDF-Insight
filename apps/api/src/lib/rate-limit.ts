export type RateLimiter = { readonly allow: (key: string) => Promise<boolean> };

export type RateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> };

export function bindingLimiter(binding: RateLimitBinding): RateLimiter {
  return { allow: async (key) => (await binding.limit({ key })).success };
}

export function memoryLimiter(limit: number, windowMs: number, now: () => number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow: (key) => {
      const t = now();
      const current = windows.get(key);
      if (current === undefined || t - current.start >= windowMs) {
        if (windows.size > 10_000) windows.clear();
        windows.set(key, { start: t, count: 1 });
        return Promise.resolve(true);
      }
      current.count += 1;
      return Promise.resolve(current.count <= limit);
    },
  };
}
