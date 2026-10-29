import { expect, type Page, test } from "@playwright/test";

// The starter with every registry block, built with `goodfellow build`, whose islands run with Preact: see
// scripts/start-preact-site.mjs.
const PAGE = "http://localhost:4415/registry/";

/** What the page loads besides its HTML, and what goes wrong in it. */
function watch(page: Page) {
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".js")) scripts.push(response.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { scripts, errors };
}

test.beforeEach(async ({ page }) => {
  // Giscus's script, as a stand-in that says it ran.
  await page.route("https://giscus.app/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "document.querySelector('.giscus').textContent = 'Giscus ran';",
    }),
  );
});

test("runs the registry's blocks with Preact, not React", async ({ page }) => {
  const { scripts, errors } = watch(page);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const code = await Promise.all(scripts.map((url) => page.request.get(url).then((response) => response.text())));
  expect(code.join("\n")).not.toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
  // Each island's ids carry its prefix, as React's do, so two FAQs never share one.
  const ids = await page.locator("main [id]").evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(errors).toEqual([]);
});

test("opens and closes the FAQs' answers, which keep saying which question they answer", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const question = page.getByRole("button", { name: "Q one" });
  await question.click();
  await expect(page.getByText("Answer one.")).toBeVisible();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  const answer = page.locator(`[id="${await question.getAttribute("aria-controls")}"]`);
  await expect(answer).toHaveAttribute("aria-labelledby", (await question.getAttribute("id")) ?? "");
  await question.click();
  await expect(page.getByText("Answer one.")).toBeHidden();
  // The second FAQ, an island of its own.
  await page.getByRole("button", { name: "Q three" }).click();
  await expect(page.getByText("Answer three.")).toBeVisible();
  await page.getByRole("button", { name: "Q one" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Q two" })).toBeFocused();
});

test("switches tabs with clicks and arrow keys", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const second = page.getByRole("tab", { name: "Second tab" });
  await second.click();
  await expect(page.getByText("Second panel.")).toBeVisible();
  await expect(page.getByText("First panel.")).toBeHidden();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await second.getAttribute("id")) ?? "");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("First panel.")).toBeVisible();
});

test("moves the image carousel with its buttons and arrow keys", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const previous = page.locator('[data-slot="carousel-previous"]');
  await expect(previous).toBeDisabled();
  await page.locator('[data-slot="carousel-next"]').click();
  await expect(previous).toBeEnabled();
  await page.locator('[data-slot="carousel"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(previous).toBeDisabled();
});

test("moves the slideshow on by itself, and stops it with its button", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const dot = (n: number) => page.getByRole("button", { name: new RegExp(`^Show picture ${n}`) });
  await expect(dot(2)).toHaveAttribute("aria-current", "true", { timeout: 5_000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await dot(3).click();
  await expect(dot(3)).toHaveAttribute("aria-current", "true");
  await page.waitForTimeout(2_500);
  await expect(dot(3)).toHaveAttribute("aria-current", "true");
});

test("counts down, loads Giscus once, and runs custom HTML's scripts", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "networkidle" });
  const clock = page.locator(".gf-countdown");
  const before = await clock.innerText();
  await expect.poll(() => clock.innerText(), { timeout: 3_000 }).not.toBe(before);
  await expect(page.locator(".giscus")).toHaveText("Giscus ran");
  await expect(page.locator('script[src^="https://giscus.app/"]')).toHaveCount(1);
  await expect(page.getByText("Script ran")).toBeVisible();
});
