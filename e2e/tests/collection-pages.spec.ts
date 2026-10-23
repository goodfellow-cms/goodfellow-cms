import type { Page } from "@playwright/test";
import { editor, expect, publishInEditor, readJson, test, writeSiteFile } from "./helpers.js";

/** A visible control in the item editor's sidebar; Puck renders hidden copies of its fields. */
function sidebar(page: Page, label: string) {
  return editor(page).getByLabel(label, { exact: true }).filter({ visible: true }).first();
}

/** The news page, with a list two stories to a page that gives each topic a page. */
function newsPage(list: Record<string, unknown>) {
  return `${JSON.stringify(
    {
      version: 1,
      data: {
        root: { props: { title: "News" } },
        content: [
          {
            type: "CollectionList",
            props: {
              id: "CollectionList-news",
              collection: "news",
              layout: "list",
              dateField: "date",
              order: "default",
              show: "all",
              limit: 1,
              paginate: true,
              choicePages: "topics",
              allLabel: "All news",
              ...list,
            },
          },
        ],
      },
    },
    null,
    2,
  )}\n`;
}

test("adds tags to a collection, tags an item, and lists each tag on pages of its own", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto("/admin#/collections/news/settings");
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label").last().fill("Topics");
  // A select's label includes its options' text, so it's found by its accessible name.
  await page
    .getByRole("combobox", { name: /^Kind of information/ })
    .last()
    .selectOption("tags");
  await page.getByRole("button", { name: "Add choice" }).click();
  await page.getByLabel("Choice 1").fill("Parish life");
  await page.getByRole("button", { name: "Add choice" }).click();
  await page.getByLabel("Choice 2").fill("Music");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/collections/news/_collection.json").fields).toContainEqual({
    name: "topics",
    label: "Topics",
    type: "tags",
    options: [
      { value: "parish-life", label: "Parish life" },
      { value: "music", label: "Music" },
    ],
  });

  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await sidebar(page, "Music").check();
  await sidebar(page, "Parish life").check();
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  // In the order the collection lists them.
  expect(readJson("content/collections/news/welcome.json")).toMatchObject({
    fields: { topics: ["parish-life", "music"] },
  });

  writeSiteFile("content/pages/news.json", newsPage({}));
  const music = await (await request.get("/news/topics/music")).text();
  expect(music).toContain("<title>News: Music");
  expect(music).toContain("Welcome to our new website");
  expect(music).not.toContain("Open house");

  // One story to a page: the second page has the other.
  const first = await (await request.get("/news")).text();
  const second = await (await request.get("/news/page/2")).text();
  const titles = [first, second].map((html) => (html.includes("Open house") ? "open house" : "welcome"));
  expect(new Set(titles).size).toBe(2);
  expect(second).toContain('rel="prev"');
  await page.goto("/news/page/2");
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "1" })).toHaveAttribute(
    "href",
    "/news",
  );
  await page.getByRole("link", { name: "Music" }).click();
  await expect(page).toHaveURL(/\/news\/topics\/music$/);
  await expect(page.getByRole("link", { name: "Music" })).toHaveAttribute("aria-current", "page");
});

test("shows blocks designed in the editor once for each item", async ({ page, request }) => {
  writeSiteFile(
    "content/pages/news.json",
    `${JSON.stringify(
      {
        version: 1,
        data: {
          root: { props: { title: "News" } },
          content: [
            {
              type: "CollectionLoop",
              props: {
                id: "CollectionLoop-news",
                collection: "news",
                order: "title",
                columns: "2",
                gap: "md",
                linkToPage: true,
                limit: 0,
                design: [{ type: "Heading", props: { id: "Heading-title", text: "Story: {title}", level: "h2" } }],
              },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  const html = await (await request.get("/news")).text();
  expect(html).toContain("Story: Open house");
  expect(html).toContain("Story: Welcome to our new website");
  expect(html).toContain('href="/news/welcome"');

  // The editor shows the design once, with its placeholders.
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/news")}`);
  const canvas = editor(page).locator(".gf-canvas").first();
  await expect(canvas.getByText("Story: {title}")).toBeVisible();
  await expect(canvas.getByText("Shown once for each item in News.")).toBeVisible();
  await expect(canvas.getByText("Story: Open house")).toHaveCount(0);
});

test("shows only the first list on a page with pages of its own, in the editor as on the site", async ({
  page,
  request,
}) => {
  const list = (id: string) => ({
    type: "CollectionList",
    props: { id, collection: "news", layout: "list", order: "default", show: "all", limit: 1, paginate: true },
  });
  writeSiteFile(
    "content/pages/news.json",
    `${JSON.stringify({ version: 1, data: { root: { props: { title: "News" } }, content: [list("CollectionList-first"), list("CollectionList-second")] } }, null, 2)}\n`,
  );
  const html = await (await request.get("/news")).text();
  expect(html.match(/aria-label="Pages"/g)).toHaveLength(1);

  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/news")}`);
  const canvas = editor(page).locator(".gf-canvas").first();
  await expect(canvas.getByText("A block higher on this page already has pages of its own")).toBeVisible();
  await expect(canvas.getByRole("navigation", { name: "Pages" })).toHaveCount(1);
});
