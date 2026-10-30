/**
 * Screenshots on the editor's computer, with the Chrome or Microsoft Edge
 * it already has, through Playwright. Nothing is downloaded: without either
 * browser, the screenshot tool says so.
 *
 * Each picture gets a browser of its own, without the GPU, which headless
 * browsers on some computers can't keep running (Chrome closes when its GPU
 * process fails), and a page is ready once it has loaded with its fonts and
 * images and its requests have stopped for a moment, rather than when the
 * network is idle for good, which a page may never be. A browser that closes
 * part-way is tried once more, with the other browser where there is one, and
 * what it said is passed on.
 */
import { DEV_API_PREFIX } from "@goodfellow-cms/core/node";
import { ToolError } from "./content.js";
import { imagePage } from "./image-page.js";
import type { Screenshotter } from "./site.js";

interface PreviewWindow {
  goodfellowPreview?: (request: unknown) => Promise<{ ok: boolean; problem?: string }>;
}

/** How long one picture may take in all: Claude's apps give up on a tool after a minute. */
export const SCREENSHOT_TIME = 45_000;

/** How tall a picture may be: taller pages are cut off there, since Claude shrinks taller images anyway. */
export const MAX_SCREENSHOT_HEIGHT = 8_000;

/** How long requests must have stopped for before a page counts as ready. */
const QUIET = 500;

/** How long to wait for that quiet before taking the picture anyway. */
const MAX_SETTLE = 8_000;

/** Lines of what the browser said to pass on, for when it closes. */
const LOG_LINES = 4;

/** What the browser itself said, which Playwright puts in its errors after "Browser logs:", without its own lines. */
export function browserSaid(message: string): string {
  const logs = message.split(/Browser logs:/)[1]?.split(/Call log:/)[0] ?? "";
  return logs
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g"), "")
    .split("\n")
    .map((line) => line.replace(/^\s*\[pid=\d+\]\[(?:err|out)\]\s*/, "").trim())
    .filter((line) => line && !/^<launch(?:ing|ed)>|^\[pid=\d+\]/.test(line))
    .slice(-LOG_LINES)
    .join(" / ");
}

type Chromium = typeof import("playwright-core").chromium;
type Browser = Awaited<ReturnType<Chromium["launch"]>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;
type Request = Parameters<Screenshotter["take"]>[0];

/** A browser that closed, or a page that crashed, while a picture was being taken. */
class BrowserClosed extends Error {
  override name = "BrowserClosed";
}

/** Waits until the page's requests have stopped for `QUIET`, its fonts are loaded and its images are in, or until `MAX_SETTLE`. */
async function settle(page: Page, inFlight: () => number, until: number): Promise<void> {
  const settleUntil = Math.min(until, Date.now() + MAX_SETTLE);
  let quietSince = inFlight() === 0 ? Date.now() : 0;
  while (Date.now() < settleUntil) {
    if (inFlight() > 0) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET) break;
    await page.waitForTimeout(100);
  }
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
      await Promise.all(
        [...document.images]
          .filter((image) => !image.complete)
          .map((image) => new Promise((done) => image.addEventListener("loadend", done, { once: true }))),
      );
    })
    .catch(() => {});
}

async function picture(browser: Browser, request: Request, until: number): Promise<Uint8Array> {
  const { url, width, preview, image, dark } = request;
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light" });
  // The page runs the site's scripts, unasked by the person, where a development server's API takes any page on
  // this computer at its word: it may read, as the developer's own browser may, but never write.
  await page.route(
    (address) => address.pathname.includes(`${DEV_API_PREFIX}/`),
    (route) => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort("blockedbyclient")),
  );
  let inFlight = 0;
  page.on("request", () => inFlight++);
  page.on("requestfinished", () => inFlight--);
  page.on("requestfailed", () => inFlight--);
  let crashed = false;
  page.on("crash", () => {
    crashed = true;
  });
  const left = () => Math.max(1_000, until - Date.now());
  try {
    if (image) await page.setContent(imagePage(url), { waitUntil: "load", timeout: left() });
    else await page.goto(url, { waitUntil: "load", timeout: left() });
    if (preview) {
      await page.waitForFunction(() => typeof (window as PreviewWindow).goodfellowPreview === "function", null, {
        timeout: left(),
      });
      const result = await page.evaluate((handed) => (window as PreviewWindow).goodfellowPreview?.(handed), preview);
      if (!result?.ok) {
        throw new ToolError(
          `The draft couldn't be shown: ${result?.problem ?? "the site's preview page didn't answer"}`,
        );
      }
    }
    await settle(page, () => inFlight, until);
    const height = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    );
    return new Uint8Array(
      await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 0, width, height: Math.max(1, Math.min(height, MAX_SCREENSHOT_HEIGHT)) },
        type: "png",
        animations: "disabled",
        caret: "hide",
        timeout: left(),
      }),
    );
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (crashed || !browser.isConnected() || /closed|crash/i.test((error as Error).message)) {
      throw new BrowserClosed((error as Error).message);
    }
    if ((error as Error).name === "TimeoutError") {
      throw new ToolError(
        `${new URL(url).host} took too long to show the page, so there's no picture. It may be slow or not answering just now; try again in a moment.`,
      );
    }
    throw error;
  }
}

export function localScreenshots(options: { executablePath?: string } = {}): Screenshotter {
  return {
    async take(request) {
      let chromium: Chromium;
      try {
        ({ chromium } = await import("playwright-core"));
      } catch {
        throw new ToolError("Screenshots aren't available: this copy of the connector was installed without them.");
      }
      const until = Date.now() + SCREENSHOT_TIME;
      const browsers: Array<{ name: string; launch: { executablePath?: string; channel?: string } }> =
        options.executablePath
          ? [{ name: "The browser", launch: { executablePath: options.executablePath } }]
          : [
              { name: "Chrome", launch: { channel: "chrome" } },
              { name: "Microsoft Edge", launch: { channel: "msedge" } },
            ];
      const found: typeof browsers = [];
      const closed: string[] = [];
      // Each browser once, and the first one found again when it's the only one: a closed browser is tried twice.
      for (let attempt = 0; attempt < 2 && Date.now() < until; attempt++) {
        const candidates = attempt === 0 ? browsers : found.length > 1 ? found.slice(1) : found;
        let browser: Browser | undefined;
        let name = "";
        for (const candidate of candidates) {
          browser = await chromium
            .launch({
              ...candidate.launch,
              headless: true,
              args: ["--disable-gpu"],
              timeout: Math.max(1_000, until - Date.now()),
            })
            .catch(() => undefined);
          if (browser) {
            name = candidate.name;
            if (attempt === 0) found.push(...browsers.slice(browsers.indexOf(candidate)));
            break;
          }
        }
        if (!browser) break;
        try {
          return await picture(browser, request, until);
        } catch (error) {
          if (!(error instanceof BrowserClosed)) throw error;
          const said = browserSaid(error.message);
          closed.push(`${name} closed while showing the page${said ? `, saying: ${said}` : ""}.`);
        } finally {
          await browser.close().catch(() => {});
        }
      }
      if (closed.length > 0) {
        throw new ToolError(
          `There's no picture: ${closed.join(" ")} Something on this computer may be stopping the browser running without a window, such as security software, or it may need restarting to finish an update.`,
        );
      }
      throw new ToolError(
        "Screenshots need Google Chrome or Microsoft Edge on this computer, or GOODFELLOW_BROWSER set to another Chromium-based browser.",
      );
    },
  };
}
