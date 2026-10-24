import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { resetContent, site } from "../scripts/site.mjs";

/**
 * Waits for a dev server to load the site's code again after it changed on disk. Until its
 * watcher has seen every change, it can mix old modules with new ones. `next dev` also
 * recompiles every page that imports the code, which can take a minute on a slow computer.
 * Leaves the page on the last of `urls`.
 */
export async function waitForCode(page: Page, urls = ["/"], timeout = 30_000): Promise<void> {
  await page.waitForTimeout(1_000);
  for (const url of urls) {
    await expect(async () => {
      // In the browser, since `next dev` compiles a page's scripts when they're first loaded.
      expect((await page.goto(url, { timeout }))?.status()).toBe(200);
      // The watcher reports changes in bursts, each reloading open pages, which would cut off
      // the test's next navigation. Done once a page stays loaded for a while.
      await page.evaluate(() => Object.assign(window, { codeSettled: true }));
      await page.waitForTimeout(2_000);
      expect(await page.evaluate(() => "codeSettled" in window).catch(() => false)).toBe(true);
    }).toPass({ timeout });
  }
}

/** Every test starts from the starter template's content, including tests that only send requests. */
export const test = base.extend({
  page: async ({ page }, use) => {
    if (resetContent()) await waitForCode(page);
    await use(page);
  },
  request: async ({ request }, use) => {
    resetContent();
    await use(request);
  },
});

export { expect };

export function readSiteFile(path: string): string {
  return readFileSync(join(site as string, path), "utf8");
}

export function writeSiteFile(path: string, content: string): void {
  writeFileSync(join(site as string, path), content);
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readSiteFile(path));
}

/** The editor: Puck, the site's config and its blocks, in the frame sandboxed away from the admin panel's page. */
export function editor(page: Page) {
  return page.frameLocator("iframe.gfa-editor-frame");
}

/** The editor's canvas: the page being edited, which Puck draws in the editor's frame. */
export function canvas(page: Page) {
  return editor(page).locator(".gf-canvas").first();
}

/**
 * Checks the editor's frame is sandboxed with `allow-scripts` alone, by what
 * a block's code could try from inside it: none of it reaches the admin
 * panel's page, storage, the network (the development servers' local backend
 * included) or WebRTC. The admin panel's own policy keeps its frames on the
 * editor's pages, so none can be shown from another address there.
 */
export async function expectSandboxed(page: Page) {
  await expect(page.locator("iframe.gfa-editor-frame")).toHaveAttribute("sandbox", "allow-scripts");
  const tried = await canvas(page).evaluate(async () => {
    const attempt = async (run: () => unknown) => {
      try {
        await run();
        return "allowed";
      } catch {
        return "refused";
      }
    };
    return {
      parent: await attempt(() => window.parent.document.title),
      storage: await attempt(() => window.localStorage.length),
      cookie: await attempt(() => document.cookie),
      fetch: await attempt(() => fetch("/admin/")),
      localBackend: await attempt(() =>
        fetch("/__goodfellow/api/version", { headers: { "x-goodfellow-request": "1" } }),
      ),
      webrtc: typeof (window as { RTCPeerConnection?: unknown }).RTCPeerConnection,
    };
  });
  expect(tried).toEqual({
    parent: "refused",
    storage: "refused",
    cookie: "refused",
    fetch: "refused",
    localBackend: "refused",
    webrtc: "undefined",
  });
  const refused = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener("securitypolicyviolation", (event) => resolve(event.effectiveDirective), {
          once: true,
        });
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.src = "https://elsewhere.invalid/";
        document.body.append(frame);
      }),
  );
  expect(refused).toBe("frame-src");
}

/**
 * Opens the editor for a page and waits for its canvas to show it. The frame
 * starts Puck and the site's code in a page of its own, which a development
 * server still starting other sites can take longer than the usual wait to serve.
 */
export async function openPageEditor(page: Page, path: string, heading: string) {
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent(path)}`);
  await expect(canvas(page).getByRole("heading", { name: heading })).toBeVisible({ timeout: 20_000 });
}

/** A field in Puck's right-hand panel. Puck renders hidden copies of fields, so only visible ones count. */
export function field(page: Page, name: string) {
  return editor(page).locator(`input[name="${name}"]:visible, textarea[name="${name}"]:visible`).first();
}

export async function publishInEditor(page: Page) {
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
}
