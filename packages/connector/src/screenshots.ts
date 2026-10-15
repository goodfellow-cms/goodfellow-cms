/**
 * Screenshots with Cloudflare's Browser Rendering, whose free plan gives a
 * few minutes of browser time a day. Without its binding, the connector
 * offers no screenshot tool.
 */
import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import { imagePage, type Screenshotter, ToolError } from "@goodfellow-cms/mcp";

interface PreviewWindow {
  goodfellowPreview?: (request: unknown) => Promise<{ ok: boolean; problem?: string }>;
}

const TIMEOUT = 30_000;

export function browserScreenshots(binding: BrowserWorker): Screenshotter {
  return {
    async take({ url, width, preview, image, dark }) {
      let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
      try {
        browser = await puppeteer.launch(binding);
      } catch {
        throw new ToolError(
          "Screenshots aren't available just now: the connector may have used its browser time for today. Try again later.",
        );
      }
      try {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 900 });
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
        if (image) await page.setContent(imagePage(url), { waitUntil: "networkidle0", timeout: TIMEOUT });
        else await page.goto(url, { waitUntil: "networkidle0", timeout: TIMEOUT });
        if (preview) {
          await page.waitForFunction(() => typeof (window as PreviewWindow).goodfellowPreview === "function", {
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
          await page.waitForNetworkIdle({ timeout: TIMEOUT });
        }
        return new Uint8Array(await page.screenshot({ fullPage: true, type: "png" }));
      } finally {
        await browser.close();
      }
    },
  };
}
