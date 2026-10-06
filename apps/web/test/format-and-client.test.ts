import { parseAnalysis, type ValidatedAnalysis } from "@pdf-insight/shared";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validResult } from "../../../packages/shared/test/fixtures";
import { requestAnalysis, type FetchFn } from "../src/api/client";
import { exportFileName, formatAmount, formatIsoDate, toExportJson } from "../src/lib/format";
import { highlightJson } from "../src/lib/json-highlight";
import { isRetryable, messageFor } from "../src/lib/messages";

function validated(): ValidatedAnalysis {
  const outcome = parseAnalysis(validResult());
  if (!outcome.ok) throw new Error("fixture must be valid");
  return outcome.value;
}

const request = { fileName: "umowa.pdf", pageCount: 1, pages: [{ number: 1, text: "Treść" }] };

function respond(status: number, body: string): FetchFn {
  return () => Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }));
}

describe("format helpers", () => {
  it("formats amounts and dates for Polish readers", () => {
    expect(formatAmount(184500, "PLN").replace(/\s/g, " ")).toBe("184 500,00 zł");
    expect(formatAmount(8600, "EUR").replace(/\s/g, " ")).toBe("8600,00 €");
    expect(formatIsoDate("2026-10-12")).toBe("12 października 2026");
  });

  it("builds a safe export file name and exports exactly the validated JSON", () => {
    const result = validated();
    expect(exportFileName(result)).toBe("umowa.insight.json");
    expect(JSON.parse(toExportJson(result))).toEqual(result);
  });
});

describe("highlightJson", () => {
  it("keeps the text intact while tokenising", () => {
    const json = toExportJson(validated());
    const text = highlightJson(json)
      .map((node) => {
        const literal = z.string().safeParse(node);
        if (literal.success) return literal.data;
        if (isValidElement(node)) return z.object({ children: z.string() }).parse(node.props).children;
        throw new Error("Expected a string or a highlighted text element");
      })
      .join("");
    expect(text).toBe(json);
  });
});

describe("requestAnalysis", () => {
  const signal = new AbortController().signal;

  it("returns a validated result on 200", async () => {
    const outcome = await requestAnalysis(request, signal, respond(200, JSON.stringify(validResult())));
    expect(outcome.ok).toBe(true);
  });

  it("sends a text-only request without client credentials", async () => {
    const outcome = await requestAnalysis(request, signal, (url, init) => {
      expect([...new Headers(init.headers).entries()]).toEqual([["content-type", "application/json"]]);
      expect(init.body).toBe(JSON.stringify(request));
      return respond(200, JSON.stringify(validResult()))(url, init);
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses to surface a 200 response that fails the schema (F-04)", async () => {
    const outcome = await requestAnalysis(
      request,
      signal,
      respond(200, JSON.stringify({ ...validResult(), keyPoints: [] })),
    );
    expect(outcome).toEqual({ ok: false, error: { source: "client", code: "INVALID_RESPONSE" } });
  });

  it("maps API error bodies to their Polish message", async () => {
    const body = JSON.stringify({ error: { code: "RATE_LIMITED", message: "x", requestId: "r-1" } });
    const outcome = await requestAnalysis(request, signal, respond(429, body));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(messageFor(outcome.error)).toContain("zbyt wiele żądań");
      expect(isRetryable(outcome.error)).toBe(true);
    }
  });

  it("reports network failures as NETWORK", async () => {
    const outcome = await requestAnalysis(request, signal, () => Promise.reject(new TypeError("Failed to fetch")));
    expect(outcome).toEqual({ ok: false, error: { source: "client", code: "NETWORK" } });
  });

  it("does not offer retry for errors a retry cannot fix", () => {
    expect(isRetryable({ source: "api", code: "NO_TEXT_LAYER", requestId: null })).toBe(false);
    expect(isRetryable({ source: "client", code: "PDF_ENCRYPTED" })).toBe(false);
  });
});
