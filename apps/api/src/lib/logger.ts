import type { ApiErrorCode } from "@pdf-insight/shared";

export type LogEvent =
  | {
      readonly event: "request";
      readonly requestId: string;
      readonly method: string;
      readonly route: string;
      readonly status: number;
      readonly ms: number;
    }
  | {
      readonly event: "ai_call";
      readonly requestId: string;
      readonly model: string;
      readonly attempt: number;
      readonly status: number;
      readonly ms: number;
      readonly outcome: "ok" | "invalid" | "http_error" | "network_error" | "timeout";
    }
  | {
      readonly event: "error";
      readonly requestId: string;
      readonly code: ApiErrorCode;
      readonly detail: string | null;
    };

export type Logger = { readonly log: (event: LogEvent) => void };

export const consoleLogger: Logger = {
  log(event) {
    // eslint-disable-next-line no-console -- the single sanctioned log sink (ADR-0008)
    console.info(JSON.stringify(event));
  },
};
