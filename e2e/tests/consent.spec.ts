import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { site } from "../scripts/site.mjs";
import { expect, readJson, readSiteFile, test, writeSiteFile } from "./helpers.js";

// A site that asks visitors before loading other sites' content: the notice, a held-back YouTube player and the
// site's own code, under `goodfellow dev`.
test("asks visitors first, and loads other sites' content once they agree", async ({ page }) => {
  const settings = readJson("content/site.json");
  writeSiteFile(
    "content/site.json",
    `${JSON.stringify({ ...settings, consent: { accept: "Allow all", policy: "/" } }, null, 2)}\n`,
  );
  writeSiteFile(
    "content/pages/watch.json",
    `${JSON.stringify(
      {
        version: 1,
        data: {
          root: { props: { title: "Watch" } },
          content: [
            { type: "Video", props: { id: "Video-1", source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ" } },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(site as string, "content/code"), { recursive: true });
  writeSiteFile("content/code/body.html", '<script>document.body.dataset.analytics = "on";</script>\n');
  const loaded: string[] = [];
  await page.route("https://www.youtube-nocookie.com/**", (route) => {
    loaded.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<p>Player</p>" });
  });

  await page.goto("/watch");
  const notice = page.getByRole("dialog", { name: "Privacy" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/");
  await expect(page.getByText("This comes from youtube-nocookie.com, which can set cookies.")).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-analytics", "on");
  expect(loaded).toEqual([]);

  await notice.getByRole("button", { name: "Allow all" }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator("iframe[title='Video']")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  );
  await expect(page.locator("body")).toHaveAttribute("data-analytics", "on");
  await expect.poll(() => loaded.length).toBe(1);

  // The answer is kept: the next page asks nothing, and a link to #consent asks again.
  await page.reload();
  await expect(page.locator("iframe[title='Video']")).toHaveAttribute("src", /youtube-nocookie/);
  await expect(notice).toBeHidden();
  await page.evaluate(() => {
    const link = Object.assign(document.createElement("a"), { href: "#consent", textContent: "Privacy choices" });
    document.body.append(link);
  });
  await page.getByRole("link", { name: "Privacy choices" }).click();
  await expect(notice).toBeVisible();
});

// Code for statistics, which visitors allow on its own, and an answer that lasts as long as the site says.
test("lets visitors choose each kind, and asks again once their answer is older than the site allows", async ({
  page,
}) => {
  const settings = readJson("content/site.json");
  writeSiteFile(
    "content/site.json",
    `${JSON.stringify({ ...settings, consent: { days: 30, code: { head: "needed", body: "statistics" } } }, null, 2)}\n`,
  );
  writeSiteFile(
    "content/pages/watch.json",
    `${JSON.stringify(
      {
        version: 1,
        data: {
          root: { props: { title: "Watch" } },
          content: [
            {
              type: "Video",
              props: { id: "Video-1", source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ", shape: "wide" },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(site as string, "content/code"), { recursive: true });
  writeSiteFile("content/code/head.html", '<script>document.documentElement.dataset.needed = "on";</script>\n');
  writeSiteFile("content/code/body.html", '<script>document.body.dataset.analytics = "on";</script>\n');
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Player</p>" }),
  );

  await page.goto("/watch");
  // Code the site needs runs without asking.
  await expect(page.locator("html")).toHaveAttribute("data-needed", "on");
  const notice = page.getByRole("dialog");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Choose" }).click();
  const choices = notice.getByRole("group", { name: "Choose" });
  await expect(choices.getByRole("checkbox", { name: /^Videos, maps, forms/ })).toBeFocused();
  await choices.getByRole("checkbox", { name: /^Statistics/ }).check();
  await notice.getByRole("button", { name: "Save my choices" }).click();
  await expect(notice).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-analytics", "on");
  await expect(page.locator("iframe[title='Video']")).not.toHaveAttribute("src", /youtube/);

  // A player's own button allows other sites' content, and keeps the visitor's other choices.
  await page.getByRole("button", { name: "Allow and show it" }).click();
  await expect(page.locator("iframe[title='Video']")).toHaveAttribute("src", /youtube-nocookie/);
  await page.reload();
  await expect(notice).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-analytics", "on");

  // Thirty-one days later, the notice asks again, and nothing it holds back loads until the visitor answers.
  await page.evaluate(() => {
    const answer = JSON.parse(localStorage.getItem("goodfellow-consent") ?? "{}");
    localStorage.setItem("goodfellow-consent", JSON.stringify({ ...answer, at: Date.now() - 31 * 86_400_000 }));
  });
  await page.reload();
  await expect(notice).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-analytics", "on");
});

test("sets how long answers last, and what the site's code is for, in Site Settings", async ({ page }) => {
  await page.goto("/admin#/settings/general?section=consent");
  await page.getByLabel("Ask visitors before showing content from other sites").check();
  await page.getByLabel("Ask again after this many days").fill("90");
  // Only one kind to ask about: the choices' words aren't asked for yet.
  await expect(page.getByLabel("Button that shows the choices")).toHaveCount(0);
  await page.getByRole("link", { name: "Code" }).click();
  await page.getByLabel("What the code at the end of the page is for").selectOption("statistics");
  await page.getByLabel("What the code in the page head is for").selectOption("needed");
  await page.getByRole("link", { name: "General" }).click();
  await expect(page.getByLabel("Button that shows the choices")).toBeVisible();
  await expect(page.getByLabel("Choice for statistics")).toHaveAttribute(
    "placeholder",
    /^Statistics that count visits/,
  );
  await expect(page.getByLabel("Choice for advertising")).toHaveCount(0);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(JSON.parse(readSiteFile("content/site.json")).consent).toMatchObject({
    days: 90,
    code: { head: "needed", body: "statistics" },
  });
});
