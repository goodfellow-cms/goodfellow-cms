import { expect, readSiteFile, test, writeSiteFile } from "./helpers.js";

const block = (type: string, id: string, props: Record<string, unknown>) => ({
  type,
  props: { id, className: "", ...props },
});

const file = (data: unknown) => `${JSON.stringify({ version: 1, data }, null, 2)}\n`;

test("opens a Gallery's pictures larger, and keeps an Announcement bar a visitor closed hidden", async ({ page }) => {
  const picture = readSiteFile("public/media/placeholder.svg");
  writeSiteFile("public/media/church.svg", picture);
  writeSiteFile("public/media/hall.svg", picture);
  writeSiteFile(
    "content/pages/visit.json",
    file({
      root: { props: { title: "Visit" } },
      content: [
        block("Heading", "title", { text: "Visit us", level: "h1", align: "left", anchor: "" }),
        block("Gallery", "pictures", {
          images: [
            { src: "/media/church.svg", alt: "The church", caption: "Our church" },
            { src: "/media/hall.svg", alt: "The hall", caption: "" },
          ],
          columns: "2",
          crop: false,
          rounded: false,
          caption: "",
          lightbox: true,
          closeLabel: "Close",
          previousLabel: "Previous picture",
          nextLabel: "Next picture",
        }),
        block("Faq", "questions", {
          heading: "Questions",
          items: [{ question: "Where do I park?", answer: "<p>Behind the hall.</p>" }],
        }),
      ],
    }),
  );
  const header = JSON.parse(readSiteFile("content/layout/header.json"));
  header.data.content.unshift(
    block("AnnouncementBar", "news", {
      message: "Christmas Mass times are here",
      href: "/visit",
      linkLabel: "See them",
      colors: "primary",
      showFrom: "",
      hideAfter: "",
      closable: true,
      closeLabel: "Close",
    }),
  );
  writeSiteFile("content/layout/header.json", `${JSON.stringify(header, null, 2)}\n`);

  await page.goto("/visit");
  // The picture's link opens it larger, with its caption, and the arrow keys move to the next.
  await page.getByRole("link", { name: "The church" }).click();
  const dialog = page.locator("dialog[data-gf-lightbox-dialog]");
  await expect(page.getByRole("dialog", { name: "The church" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "The church" })).toBeVisible();
  await expect(dialog).toContainText("Our church");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "The hall" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "The church" })).toBeFocused();

  // Questions open to their answers.
  await page.getByText("Where do I park?").click();
  await expect(page.getByText("Behind the hall.")).toBeVisible();

  // Closed, the bar stays closed on the next page.
  const bar = page.getByRole("region", { name: "Christmas Mass times are here" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Close" }).click();
  await expect(bar).toBeHidden();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Christmas Mass times are here" })).toBeHidden();
  await expect(page.getByText("Christmas Mass times are here")).toBeHidden();
});
