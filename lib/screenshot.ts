import { chromium, type Browser } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const COOKIE_DISMISS_SELECTORS = [
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Allow all")',
  'button:has-text("Got it")',
  '[id*="cookie"] button:has-text("Accept")',
  '[class*="cookie"] button:has-text("Accept")',
];

export type ScreenshotResult = {
  path: string;
  buffer: Buffer;
  bytes: number;
  viewport: string;
};

export async function takeScreenshot(params: {
  url: string;
  competitorId: string;
  sourceType: string;
}): Promise<ScreenshotResult> {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(params.url, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    for (const selector of COOKIE_DISMISS_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 250 })) {
          await btn.click({ timeout: 1_000 });
          await page.waitForTimeout(400);
          break;
        }
      } catch {
        // ignore - banner not present or selector failed
      }
    }

    const buffer = await page.screenshot({ fullPage: false, type: "png" });

    const dir = join(
      process.cwd(),
      "data",
      "screenshots",
      params.competitorId,
      params.sourceType,
    );
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${ts}.png`);
    writeFileSync(path, buffer);

    return {
      path,
      buffer,
      bytes: buffer.length,
      viewport: `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`,
    };
  } finally {
    await browser.close();
  }
}
