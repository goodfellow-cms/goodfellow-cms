// Takes the docs' screenshots of the admin panel and the setup page, into the built docs
// (dist/screenshots/), so they're never kept in the repository and always show the release
// the docs describe. .github/workflows/docs.yml runs it after building the docs and the demo:
//
//   node scripts/screenshots.mjs <the built docs> <the base path they were built with> <sign-in preview>
//
// The sign-in preview is the demo's site stored on GitHub, which scripts/demo.mjs builds when
// GOODFELLOW_SIGN_IN_PREVIEW names a folder. The browser is Chrome, as GitHub's runners have
// it, or the one CHROME_PATH names.
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright-core";

const [dist, basePath = "", signInPreview] = process.argv.slice(2);
if (!dist || !signInPreview) {
  console.error("Usage: node scripts/screenshots.mjs <built docs> <base path> <sign-in preview>");
  process.exit(1);
}
const base = basePath.replace(/\/+$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};

/** Serves a built site's folder at `prefix`, as a static host would, on a port of its own on this computer. */
async function serve(root, prefix) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (!path.startsWith(`${prefix}/`)) {
      response.writeHead(404).end();
      return;
    }
    let file = normalize(join(root, path.slice(prefix.length)));
    if (!file.startsWith(resolve(root))) {
      response.writeHead(404).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}${prefix}` };
}

const docs = await serve(resolve(dist), base);
const preview = await serve(resolve(signInPreview), "");
const out = join(resolve(dist), "screenshots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
  });
  // The demo's banner is left out: readers' own admin panels don't have it.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".gfa-demo-banner { display: none !important; }";
      document.head.append(style);
    });
  });
  const page = await context.newPage();
  const shot = async (name, target = page) => {
    await target.screenshot({ path: join(out, `${name}.png`), animations: "disabled" });
    console.log(`Took ${name}.png.`);
  };

  // The setup page, as someone making a site first sees it.
  await page.goto(`${docs.url}/new-site/`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await shot("setup-page");

  // The sign-in screen of a site stored on GitHub.
  await page.goto(`${preview.url}/admin/`);
  await page
    .getByRole("button", { name: /sign in/i })
    .first()
    .waitFor();
  await shot("sign-in");

  // The demo's Pages screen, then the editor with its home page.
  await page.goto(`${docs.url}/demo/admin/#/pages`);
  await page.getByRole("button", { name: "New page" }).waitFor();
  await shot("pages");

  await page.goto(`${docs.url}/demo/admin/#/pages/edit?path=%2F`);
  const canvas = page.frameLocator("iframe.gfa-editor-frame").locator(".gf-canvas").first();
  await canvas.locator("[data-puck-component]").first().waitFor();
  // Fonts and pictures settle before the picture is taken.
  await page.waitForTimeout(1500);
  await shot("editor");

  // The editor's header once something has changed, with Undo, Add to draft and Publish.
  const title = page
    .frameLocator("iframe.gfa-editor-frame")
    .getByRole("textbox", { name: "Page title" })
    .and(page.frameLocator("iframe.gfa-editor-frame").locator(":visible"));
  await title.fill(`${await title.inputValue()}, welcome`);
  await page.getByRole("button", { name: "Undo" }).and(page.locator(":enabled")).waitFor();
  await shot("publish", page.locator(".gfa-editor-header"));
} finally {
  await browser.close();
  docs.server.close();
  preview.server.close();
}
