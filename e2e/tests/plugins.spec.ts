import { canvas, expect, readSiteFile, test, writeSiteFile } from "./helpers";

/** A page with the Greeter plugin's block (`e2e/fixtures/plugins/greeter`). */
const greetPage = {
  version: 1,
  data: {
    content: [
      { type: "Heading", props: { id: "Heading-1", className: "", text: "Greetings", level: "h1" } },
      { type: "Greeting", props: { id: "Greeting-1", className: "", name: "Ada" } },
    ],
    root: { props: { className: "", description: "", image: "", title: "Greetings" } },
  },
};

test("a plugin's screen publishes only the files it declared, and reaches only the addresses it declared", async ({
  page,
}) => {
  await page.goto("/admin#/settings/general");
  await page.getByRole("link", { name: "Greeter" }).click();
  // The plugin's own frame, sandboxed away from the admin panel's sign-in like the editor's, is the whole
  // screen: the plugin draws its heading, and the frame is as tall as what it draws.
  await expect(page.locator('iframe[title="Greeter"]')).toHaveAttribute("sandbox", "allow-scripts");
  const screen = page.frameLocator('iframe[title="Greeter"]');
  await expect(screen.getByRole("heading", { name: "Greeter", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Greeter" })).toHaveCount(0);
  await expect(page.locator('iframe[title="Greeter"]')).toHaveAttribute("style", /height: \d+px/);

  await screen.getByLabel("Message").fill("Welcome, friends");
  await screen.getByRole("button", { name: "Save" }).click();
  await expect(screen.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });
  expect(JSON.parse(readSiteFile("content/greeter.json"))).toEqual({ message: "Welcome, friends" });

  // Files it didn't declare aren't published, and addresses it didn't declare aren't reached.
  const settings = readSiteFile("content/site.json");
  await screen.getByRole("button", { name: "Change the site's title" }).click();
  await expect(screen.getByRole("status")).toContainText("Greeter didn't ask to change content/site.json");
  expect(readSiteFile("content/site.json")).toBe(settings);
  await screen.getByRole("button", { name: "Reach another site" }).click();
  await expect(screen.getByRole("status")).toContainText("Refused");
});

test("a plugin's block asks the plugin's service in the editor, through the plugin's own frame", async ({ page }) => {
  writeSiteFile("content/pages/greetings.json", `${JSON.stringify(greetPage, null, 2)}\n`);
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/greetings")}`);
  await expect(canvas(page).locator("[data-greeting]")).toHaveText("Hello, Ada, from the plugin!", {
    timeout: 30_000,
  });

  // The published page has no plugin to ask: it shows the name the block was given.
  await page.goto("/greetings");
  await expect(page.locator("[data-greeting]")).toHaveText("Ada");
});
