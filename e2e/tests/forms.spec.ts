import { editor, expect, readJson, readSiteFile, test, writeSiteFile } from "./helpers.js";

const KEY = "0b5c4f7e-1a2b-4c3d-8e9f-0123456789ab";

function page(title: string, content: unknown[]) {
  return `${JSON.stringify({ version: 1, data: { root: { props: { title } }, content } }, null, 2)}\n`;
}

test("a visitor sends a form to Web3Forms, which sends them back to the thank-you page", async ({ page: browser }) => {
  const settings = readJson("content/site.json");
  writeSiteFile(
    "content/site.json",
    `${JSON.stringify({ ...settings, url: "https://parish.example.org", forms: { service: "web3forms", accessKey: KEY } }, null, 2)}\n`,
  );
  writeSiteFile(
    "content/pages/contact-us.json",
    page("Contact us", [
      {
        type: "Form",
        props: {
          id: "Form-contact",
          source: "fields",
          title: "Prayer request",
          fields: [
            { label: "Name", type: "text", required: true, choices: "", hint: "" },
            { label: "Email", type: "email", required: true, choices: "", hint: "" },
            { label: "Mass", type: "select", required: false, choices: "Saturday 5 pm\nSunday 9 am", hint: "" },
          ],
          submitLabel: "Send",
          thankYou: "/thank-you",
          google: "",
          height: 800,
          className: "",
        },
      },
    ]),
  );
  writeSiteFile(
    "content/pages/thank-you.json",
    page("Thank you", [{ type: "Heading", props: { id: "Heading-thanks", text: "Thank you", level: "h1" } }]),
  );

  // Tests never reach Web3Forms: its answer sends the visitor to the redirect, here on this computer.
  let sent: URLSearchParams | undefined;
  await browser.route("https://api.web3forms.com/submit", async (route) => {
    sent = new URLSearchParams(route.request().postData() ?? "");
    const back = new URL(sent.get("redirect") ?? "/", "http://localhost").pathname;
    await route.fulfill({ status: 303, headers: { location: new URL(back, browser.url()).href } });
  });

  await browser.goto("/contact-us");
  await browser.getByRole("button", { name: "Send" }).click();
  // Browsers check required questions themselves, so nothing is sent yet.
  expect(sent).toBeUndefined();

  await browser.getByLabel("Name").fill("Maria Example");
  await browser.getByLabel("Email").fill("maria@example.org");
  await browser.getByLabel("Mass").selectOption("Sunday 9 am");
  await browser.getByRole("button", { name: "Send" }).click();

  await expect(browser.getByRole("heading", { name: "Thank you" })).toBeVisible();
  expect(Object.fromEntries(sent ?? [])).toEqual({
    access_key: KEY,
    subject: "Prayer request",
    from_name: "My site",
    redirect: "https://parish.example.org/thank-you",
    Name: "Maria Example",
    email: "maria@example.org",
    Mass: "Sunday 9 am",
  });
});

test("chooses where forms' answers go in Site settings", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  const before = readSiteFile("content/site.json");
  await page.getByLabel("Web3Forms access key").fill("maria@example.org");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("This isn't a Web3Forms access key.")).toBeVisible();
  expect(readSiteFile("content/site.json")).toBe(before);

  await page.getByLabel("Web3Forms access key").fill(KEY);
  await page.getByLabel("Ask visitors to show they aren't robots (hCaptcha)").check();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json").forms).toEqual({ service: "web3forms", accessKey: KEY, captcha: true });

  await page.getByLabel("Form service").selectOption("formspree");
  await page.getByLabel("Formspree form address").fill("https://formspree.io/f/xyzabcde");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json").forms).toMatchObject({
    service: "formspree",
    address: "https://formspree.io/f/xyzabcde",
  });
});

test("links a form's note in the editor to Site Settings' Forms", async ({ page: browser }) => {
  writeSiteFile(
    "content/pages/contact-us.json",
    page("Contact us", [{ type: "Form", props: { id: "Form-contact", source: "fields", title: "Contact form" } }]),
  );
  await browser.goto(`/admin#/pages/edit?path=${encodeURIComponent("/contact-us")}`);
  const note = editor(browser)
    .locator(".gf-canvas")
    .first()
    .getByRole("link", { name: /add Web3Forms' access key/ });
  await note.click();

  await expect(browser).toHaveURL(/#\/settings\/general\?section=forms$/);
  await expect(browser.getByRole("heading", { name: "Forms" })).toBeFocused();
  await expect(browser.getByRole("heading", { name: "Forms" })).toBeInViewport();
});
