import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { site } from "../scripts/site.mjs";
import { expect, readJson, test, writeSiteFile } from "./helpers.js";

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
