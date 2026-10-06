import { createApp } from "./app";
import { consoleLogger } from "./lib/logger";
import { memoryLimiter } from "./lib/rate-limit";

const app = createApp({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  uuid: () => crypto.randomUUID(),
  logger: consoleLogger,
  fallbackLimiter: memoryLimiter(10, 60_000, () => Date.now()),
});

export default app;
