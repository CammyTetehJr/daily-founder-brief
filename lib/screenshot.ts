import { chromium, type Browser } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_VIEWPORT = { width: 1440, height: 1024 };
// Cap full-page captures so a marketing page with infinite scroll
// or huge footers doesn't generate a 30MB PNG.
const MAX_FULL_PAGE_HEIGHT = 4500;
const COOKIE_DISMISS_SELECTORS = [
  'button:has-text("Accept all cookies")',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I accept")',
  'button:has-text("I agree")',
  'button:has-text("Allow all")',
  'button:has-text("Allow")',
  'button:has-text("Got it")',
  'button:has-text("OK")',
  '[aria-label*="accept" i]',
  '[id*="onetrust-accept"]',
  '[id*="cookie"] button',
  '[class*="cookie"] button',
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
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    // Brief settle so above-the-fold content paints / fonts swap in.
    // We no longer wait for networkidle because tracking pixels and
    // analytics keep marketing pages from ever fully going idle.
    await page.waitForTimeout(1_500);

    for (const selector of COOKIE_DISMISS_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 250 })) {
          await btn.click({ timeout: 1_000 });
          await page.waitForTimeout(600);
          break;
        }
      } catch {
        // ignore - banner not present or selector failed
      }
    }

    // Scroll to top in case the page anchored to a deep section.
    await page
      .evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }))
      .catch(() => {});
    await page.waitForTimeout(300);

    const buffer = await page.screenshot({
      fullPage: true,
      type: "png",
      clip: undefined,
    });

    // If the full-page screenshot exceeds our cap, recapture clipped to the cap height.
    let finalBuffer = buffer;
    if (buffer.length > 4_000_000) {
      finalBuffer = await page.screenshot({
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: DEFAULT_VIEWPORT.width,
          height: MAX_FULL_PAGE_HEIGHT,
        },
      });
    }

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
    writeFileSync(path, finalBuffer);

    return {
      path,
      buffer: finalBuffer,
      bytes: finalBuffer.length,
      viewport: `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`,
    };
  } finally {
    await browser.close();
  }
}
