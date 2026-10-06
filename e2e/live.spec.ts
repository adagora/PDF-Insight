import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const TEST_PDF = join(process.cwd(), "raw/Test_PDF_Insight_umowa_14-2026.pdf");
const SHOTS = process.env.E2E_SCREENSHOTS;

test.describe("live: real PDF through the real API and Gemini", () => {
  test.skip(
    process.env.E2E_LIVE !== "1" || !existsSync(TEST_PDF),
    "set E2E_LIVE=1 with the API running and the test PDF in raw/",
  );

  test("test contract is summarised in < 30 s, the injection is flagged, the scanned annex is read", async ({
    page,
  }, info) => {
    await page.goto("./");
    if (SHOTS !== undefined)
      await page.screenshot({ path: join(SHOTS, `${info.project.name}-1-home.png`), fullPage: true });

    const started = Date.now();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /przeciągnij tutaj plik pdf/i }).click();
    await (await chooser).setFiles(TEST_PDF);
    await expect(page.getByRole("heading", { name: /analizuję dokument/i })).toBeVisible({ timeout: 30_000 });
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${info.project.name}-2-progress.png`) });

    await expect(page.getByRole("heading", { level: 2, name: /UMOWA RAMOWA NR 14\/2026/i })).toBeVisible({
      timeout: 30_000,
    });
    expect(Date.now() - started).toBeLessThan(30_000);

    const summary = await page.locator(".summary-text").innerText();
    expect(summary).not.toMatch(/nieważn|\b1 PLN\b|\b1 zł\b/i);
    await expect(page.getByText(/wyglądający na polecenie dla systemu AI/)).toBeVisible();
    await expect(page.getByText(/odczytano z obrazu \(OCR\)/)).toBeVisible();
    await expect(page.getByText(/13\s100,00\s?zł/).first()).toBeVisible();
    if (SHOTS !== undefined)
      await page.screenshot({ path: join(SHOTS, `${info.project.name}-3-result.png`), fullPage: true });

    await page.getByRole("tab", { name: "JSON" }).click();
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${info.project.name}-4-json.png`) });
  });
});
