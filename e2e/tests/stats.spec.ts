import { expect, readJson, test } from "./helpers.js";

const WEBSITE = "94db1cb1-74f4-4a40-ad6c-962362670409";

test("an owner counts visits with Umami, opens its dashboard, and stops counting", async ({ page }) => {
  await page.goto("/admin/#/settings/stats");
  await expect(page.getByRole("heading", { name: "Visit counts", level: 1 })).toBeVisible();
  await page.getByRole("radio", { name: "Umami" }).check();
  const field = page.getByLabel("Code or details");
  await field.fill('<script src="http://127.0.0.1/script.js" data-website-id="nope"></script>');
  await expect(page.getByRole("button", { name: "Start counting" })).toBeDisabled();

  await field.fill(`<script defer src="https://cloud.umami.is/script.js" data-website-id="${WEBSITE}"></script>`);
  await page.getByRole("button", { name: "Start counting" }).click();
  const dashboard = page.getByRole("link", { name: "Open Umami's dashboard" });
  await expect(dashboard).toHaveAttribute("href", `https://cloud.umami.is/websites/${WEBSITE}`);
  await expect(dashboard).toHaveAttribute("target", "_blank");
  expect(readJson("content/site.json").stats).toEqual({
    service: "umami",
    website: WEBSITE,
    script: "https://cloud.umami.is/script.js",
  });

  // Counting without visitors' agreement is the owner's choice.
  const agree = page.getByRole("checkbox", { name: "Count only visitors who agree" });
  await agree.click();
  await expect(agree).not.toBeChecked();
  expect(readJson("content/site.json").stats).toMatchObject({ purpose: "needed" });

  // The development server never counts visits.
  const html = await (await page.request.get("/")).text();
  expect(html).not.toContain("cloud.umami.is");

  await page.getByRole("button", { name: "Stop counting" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop counting" }).click();
  await expect(page.getByRole("button", { name: "Start counting" })).toBeVisible();
  expect(readJson("content/site.json").stats).toBeUndefined();
});
