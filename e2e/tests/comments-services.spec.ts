import { expect, readJson, test } from "./helpers.js";

test("an owner uses Disqus for comments on any site, and stops using it", async ({ page }) => {
  await page.goto("/admin/#/settings/comments");
  // Comments on GitHub need the live site's sign-in; Disqus doesn't.
  await expect(page.getByText("Disqus can be set up here.", { exact: false })).toBeVisible();
  const field = page.getByLabel("Disqus's shortname, or its code");
  await field.fill("St Joseph");
  await page.getByRole("button", { name: "Use Disqus" }).click();
  await expect(page.getByText("That isn't a shortname or Disqus's code.", { exact: false })).toBeVisible();
  expect(readJson("content/site.json").comments).toBeUndefined();

  // Disqus's code names the site's shortname in its script's address.
  await field.fill(`<div id="disqus_thread"></div>
<script>
  (function() {
    var d = document, s = d.createElement('script');
    s.src = 'https://stjoseph.disqus.com/embed.js';
    (d.head || d.body).appendChild(s);
  })();
</script>`);
  await page.getByRole("button", { name: "Use Disqus" }).click();
  await expect(page.getByRole("link", { name: "Moderate comments on Disqus" })).toHaveAttribute(
    "href",
    "https://stjoseph.disqus.com/admin/moderate/",
  );
  expect(readJson("content/site.json").comments).toEqual({ disqus: "stjoseph" });

  await page.getByRole("button", { name: "Stop using comments" }).click();
  await expect(page.getByRole("dialog")).toContainText("Everything visitors wrote stays on Disqus");
  await page.getByRole("dialog").getByRole("button", { name: "Stop using comments" }).click();
  await expect(page.getByRole("button", { name: "Use Disqus" })).toBeVisible();
  expect(readJson("content/site.json").comments).toBeUndefined();
});

test("an owner uses Garrul, on a Cloudflare account of their own, for comments", async ({ page }) => {
  await page.goto("/admin/#/settings/comments");
  const field = page.getByLabel("Garrul's address, or its code");
  await field.fill("http://comments.example.org");
  await page.getByRole("button", { name: "Use Garrul" }).click();
  await expect(page.getByText("That isn't an address or Garrul's code.", { exact: false })).toBeVisible();

  // Garrul's code for a page names its Worker's address.
  await field.fill(`<div id="garrul" data-slug="my-post-slug" data-api="https://comments.example.org"></div>
<script src="https://comments.example.org/embed.js" defer></script>`);
  await page.getByRole("button", { name: "Use Garrul" }).click();
  await expect(page.getByRole("link", { name: "Moderate comments on Garrul" })).toHaveAttribute(
    "href",
    "https://comments.example.org/admin/queue?status=pending",
  );
  await expect(page.getByText("its ALLOWED_ORIGINS must include the site's address", { exact: false })).toBeVisible();
  expect(readJson("content/site.json").comments).toEqual({ garrul: "https://comments.example.org" });
});
