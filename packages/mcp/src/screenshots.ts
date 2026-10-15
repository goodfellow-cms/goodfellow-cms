/**
 * Screenshots on the editor's computer, with the Chrome or Microsoft Edge
 * it already has, through Playwright. Nothing is downloaded: without either
 * browser, the screenshot tool says so.
 */
import { ToolError } from "./content.js";
import { imagePage } from "./image-page.js";
import type { Screenshotter } from "./site.js";

interface PreviewWindow {
  goodfellowPreview?: (request: unknown) => Promise<{ ok: boolean; problem?: string }>;
}

/** How long a page may take to load and settle. */
const TIMEOUT = 30_000;

export function localScreenshots(options: { executablePath?: string } = {}): Screenshotter {
  return {
    async take({ url, width, preview, image, dark }) {
      let chromium: typeof import("playwright-core").chromium;
      try {
        ({ chromium } = await import("playwright-core"));
      } catch {
        throw new ToolError("Screenshots aren't available: this copy of the connector was installed without them.");
      }
      const attempts = options.executablePath
        ? [{ executablePath: options.executablePath }]
        : [{ channel: "chrome" }, { channel: "msedge" }];
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      for (const attempt of attempts) {
        browser = await chromium.launch({ ...attempt, headless: true }).catch(() => undefined);
        if (browser) break;
      }
      if (!browser) {
        throw new ToolError(
          "Screenshots need Google Chrome or Microsoft Edge on this computer, or GOODFELLOW_BROWSER set to another Chromium-based browser.",
        );
      }
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light" });
        if (image) await page.setContent(imagePage(url), { waitUntil: "networkidle", timeout: TIMEOUT });
        else await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT });
        if (preview) {
          await page.waitForFunction(() => typeof (window as PreviewWindow).goodfellowPreview === "function", null, {
            timeout: TIMEOUT,
          });
          const result = await page.evaluate(
            (request) => (window as PreviewWindow).goodfellowPreview?.(request),
            preview,
          );
          if (!result?.ok) {
            throw new ToolError(
              `The draft couldn't be shown: ${result?.problem ?? "the site's preview page didn't answer"}`,
            );
          }
          // Its images and fonts.
          await page.waitForLoadState("networkidle", { timeout: TIMEOUT });
        }
        return new Uint8Array(await page.screenshot({ fullPage: true, type: "png" }));
      } finally {
        await browser.close();
      }
    },
  };
}
