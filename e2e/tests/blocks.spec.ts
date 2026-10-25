import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect as baseExpect, test as baseTest, type Page } from "@playwright/test";
import { nextSite, resetNextContent, site } from "../scripts/site.mjs";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";
import { canvas, editor, test, waitForCode, writeSiteFile } from "./helpers.js";

// Adding a block rebuilds the dev server's modules, so allow for that.
const expect = baseExpect.configure({ timeout: 30_000 });

const faqPage = {
  version: 1,
  data: {
    content: [
      {
        type: "shadcn-faq",
        props: {
          id: "shadcn-faq-1",
          className: "",
          title: "Common questions",
          questions: [{ question: "When are you open?", answer: "<p>Every day but Monday.</p>" }],
        },
      },
    ],
    root: { props: { className: "", description: "", image: "", title: "Help" } },
  },
};

const onDisk = (path: string) => existsSync(join(site as string, path));

/** Publishes the blocks marked to add or remove, all together. */
async function publishBlocks(page: Page) {
  await page.getByRole("region", { name: "Changes to publish" }).getByRole("button", { name: "Publish" }).click();
}

/** Waits for the development server to have rebuilt the editor's frames with a block's code. */
async function editorHas(page: Page, block: string) {
  await expect
    .poll(
      async () => {
        try {
          const html = await (await page.request.get("/admin/editor/")).text();
          const script = /<script src="([^"]+)"/.exec(html)?.[1];
          return script ? (await (await page.request.get(script)).text()).includes(JSON.stringify(block)) : false;
        } catch {
          // The server can drop a request while it rebuilds the frames, so ask again.
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function addFaq(page: Page) {
  await page.goto("/admin#/blocks");
  await expect(page.getByRole("heading", { name: "Interactive" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "FAQ" }).getByText("Recommended")).toBeVisible();
  await page.getByRole("button", { name: "Add FAQ" }).click();
  await publishBlocks(page);
  await expect.poll(() => onDisk("blocks/installed/installed.json")).toBe(true);
  await editorHas(page, "shadcn-faq");
}

test("adds a block from Goodfellow's registry, which the editor then offers and the site runs", async ({ page }) => {
  await addFaq(page);
  for (const path of [
    "blocks/installed/shadcn-faq/block.tsx",
    "blocks/installed/shadcn-faq/faq-list.tsx",
    "components/ui/accordion.tsx",
  ]) {
    expect(onDisk(path), path).toBe(true);
  }
  expect(readFileSync(join(site as string, "blocks/installed/index.ts"), "utf8")).toContain('"shadcn-faq": block0');

  await page.goto("/admin#/blocks");
  const added = page.locator(".gfa-block-list");
  await expect(added).toContainText("FAQ");
  await expect(page.getByRole("button", { name: "Add FAQ" })).toBeHidden();

  // The editor offers it, in its own group.
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/about")}`);
  await expect(editor(page).getByText("FAQ", { exact: true }).first()).toBeVisible();

  // And it runs on the site: answers open when their question is clicked.
  writeSiteFile("content/pages/help.json", `${JSON.stringify(faqPage, null, 2)}\n`);
  await page.goto("/help");
  const answer = page.getByText("Every day but Monday.");
  await expect(answer).toBeHidden();
  await expect(async () => {
    if (!(await answer.isVisible())) await page.getByRole("button", { name: "When are you open?" }).click();
    baseExpect(await answer.isVisible()).toBe(true);
  }).toPass({ timeout: 30_000 });
});

test("runs custom HTML used as written on the site, and only shows it in the editor, in a sandboxed frame", async ({
  page,
}) => {
  await page.goto("/admin#/blocks");
  await expect(page.getByRole("heading", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Custom HTML" }).getByText("Recommended")).toBeHidden();
  await page.getByRole("button", { name: "Add Custom HTML" }).click();
  await publishBlocks(page);
  await expect.poll(() => onDisk("blocks/installed/custom-html/block.tsx")).toBe(true);
  await editorHas(page, "custom-html");

  const html =
    '<p id="widget">Widget</p><script>window.runs = (window.runs || 0) + 1; document.getElementById("widget").textContent = "Ran " + window.runs; try { window.parent.document.title = "Reached"; } catch {}</script>';
  writeSiteFile(
    "content/pages/widget.json",
    `${JSON.stringify(
      {
        version: 1,
        data: {
          content: [{ type: "custom-html", props: { id: "custom-html-1", className: "", html, sanitize: false } }],
          root: { props: { className: "", description: "", image: "", title: "Widget" } },
        },
      },
      null,
      2,
    )}\n`,
  );

  await page.goto("/widget");
  await expect(page.locator("#widget")).toHaveText("Ran 1");
  // Its script ran with the page, and not again once the page's Client Components started.
  const island = page.locator('gf-island[data-gf-export="HtmlWithScripts"]');
  await expect(island).toHaveCount(1);
  // React has taken over the block once it marks the island as a root.
  await expect
    .poll(() => island.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactContainer"))))
    .toBe(true);
  await expect(page.locator("#widget")).toHaveText("Ran 1");

  await page.goto("/admin#/");
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/widget")}`);
  // The editor runs only its own scripts, so the HTML is shown as it is, with nothing allowed.
  const frame = canvas(page).frameLocator('iframe[title="Custom HTML"]');
  await expect(frame.locator("#widget")).toHaveText("Widget");
  await expect(canvas(page).locator('iframe[title="Custom HTML"]')).toHaveAttribute("sandbox", "");
  await expect(canvas(page).getByText("Scripts don't run in the editor.")).toBeVisible();
  expect(await page.title()).not.toBe("Reached");
  expect(await canvas(page).evaluate((element: Element) => element.ownerDocument.title)).not.toBe("Reached");
});

test("won't remove a block that's in use, and removes it once it isn't", async ({ page }) => {
  await addFaq(page);
  writeSiteFile("content/pages/help.json", `${JSON.stringify(faqPage, null, 2)}\n`);

  // Loads the site again, with the new page.
  await page.reload();
  await page.getByRole("button", { name: "Remove FAQ" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("FAQ is used in: Help (/help)");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "Changes to publish" })).toBeHidden();

  rmSync(join(site as string, "content/pages/help.json"));
  await page.reload();
  await page.getByRole("button", { name: "Remove FAQ" }).click();
  await expect(page.getByRole("region", { name: "Changes to publish" })).toContainText("Remove FAQ");
  // Nothing changes until it's published.
  expect(onDisk("blocks/installed/shadcn-faq/block.tsx")).toBe(true);
  await publishBlocks(page);
  await expect.poll(() => onDisk("blocks/installed/shadcn-faq/block.tsx")).toBe(false);
  expect(onDisk("components/ui/accordion.tsx")).toBe(false);
  // The index is written after the block's files are removed.
  await expect
    .poll(() => readFileSync(join(site as string, "blocks/installed/index.ts"), "utf8"))
    .not.toContain("shadcn-faq");
});

// The built site's admin panel installs from the registry's release on jsDelivr; tests serve the built registry instead.
const registryDir = fileURLToPath(new URL("../node_modules/@goodfellow-cms/registry/r/", import.meta.url));

baseTest("adds a block to a site on GitHub in one publish", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.route(
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/@goodfellow-cms\/registry@[^/]+\/r\/([a-z0-9-]+\.json)$/,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: readFileSync(join(registryDir, new URL(route.request().url()).pathname.split("/").at(-1) ?? ""), "utf8"),
      }),
  );

  await page.goto(`${GITHUB_SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Blocks", exact: true }).click();
  const before = fake.repo.head();
  await page.getByRole("button", { name: "Add Tabs" }).click();
  await page.getByRole("button", { name: "Add FAQ" }).click();
  await baseExpect(page.getByRole("region", { name: "Changes to publish" })).toContainText("Add Tabs");
  await publishBlocks(page);
  await baseExpect(page.getByText("Published. Added blocks will be in the editor")).toBeVisible();

  // Both in one save.
  const commit = fake.repo.commitAt(fake.repo.head());
  baseExpect(commit?.message).toBe("Change blocks: add Tabs, FAQ");
  baseExpect(commit?.parent).toBe(before);
  const repoFiles = fake.repo.files();
  for (const path of [
    "blocks/installed/shadcn-tabs/block.tsx",
    "blocks/installed/shadcn-tabs/tabs-view.tsx",
    "components/ui/tabs.tsx",
    "blocks/installed/shadcn-faq/block.tsx",
    "components/ui/accordion.tsx",
    "blocks/installed/installed.json",
    "blocks/installed/index.ts",
  ]) {
    baseExpect(repoFiles.has(path), path).toBe(true);
  }
  await baseExpect(page.locator(".gfa-block-list")).toContainText("Tabs");
  await baseExpect(page.locator(".gfa-block-list")).toContainText("FAQ");
});

baseTest("adds blocks to a Next.js site, which then runs them, also after moving between pages", async ({ page }) => {
  // `next dev` recompiles once after adding the blocks and again after the test resets them.
  baseTest.setTimeout(400_000);
  const root = nextSite as string;
  resetNextContent();
  try {
    await page.goto("http://localhost:4403/admin/#/blocks");
    await page.getByRole("button", { name: "Add FAQ" }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add Custom HTML" }).click();
    await publishBlocks(page);
    await expect.poll(() => existsSync(join(root, "blocks/installed/installed.json")), { timeout: 60_000 }).toBe(true);

    const html =
      '<p id="widget">Widget</p><script>window.runs = (window.runs || 0) + 1; document.getElementById("widget").textContent = "Ran " + window.runs;</script>';
    const helpPage = {
      ...faqPage,
      data: {
        ...faqPage.data,
        content: [
          ...faqPage.data.content,
          { type: "custom-html", props: { id: "custom-html-1", className: "", html, sanitize: false } },
        ],
      },
    };
    writeFileSync(join(root, "content/pages/help.json"), `${JSON.stringify(helpPage, null, 2)}\n`);
    const menus = JSON.parse(readFileSync(join(root, "content/menus.json"), "utf8"));
    menus.menus.main.push({ href: "/help", label: "Help" });
    writeFileSync(join(root, "content/menus.json"), `${JSON.stringify(menus, null, 2)}\n`);

    // `next dev` recompiles once the blocks are on disk; a page asked for meanwhile may not have them yet.
    await expect(async () => {
      await page.goto("http://localhost:4403/help/");
      await baseExpect(page.getByRole("button", { name: "When are you open?" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
    const answer = page.getByText("Every day but Monday.");
    await expect(answer).toBeHidden();
    await expect(async () => {
      if (!(await answer.isVisible())) await page.getByRole("button", { name: "When are you open?" }).click();
      baseExpect(await answer.isVisible()).toBe(true);
    }).toPass({ timeout: 60_000 });
    // Opened directly, the page ran the script once, and React taking over didn't run it again.
    await expect(page.locator("#widget")).toHaveText("Ran 1");

    // Moving to the page from another one runs its script too.
    await page.goto("http://localhost:4403/about/");
    await page.evaluate(() => Object.assign(window, { beforeMoving: true }));
    await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Help" }).click();
    await expect(page.locator("#widget")).toHaveText("Ran 1");
    baseExpect(await page.evaluate(() => "beforeMoving" in window)).toBe(true);
    // And again after moving away and back.
    await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "About" }).click();
    await expect(page.locator("#widget")).toBeHidden();
    await page.getByRole("navigation", { name: "main" }).getByRole("link", { name: "Help" }).click();
    await expect(page.locator("#widget")).toHaveText("Ran 2");
    baseExpect(await page.evaluate(() => "beforeMoving" in window)).toBe(true);
  } finally {
    // The site's pages and the admin panel both import the blocks, so both recompile.
    if (resetNextContent()) {
      await waitForCode(page, ["http://localhost:4403/about/", "http://localhost:4403/admin/"], 120_000);
    }
  }
});
