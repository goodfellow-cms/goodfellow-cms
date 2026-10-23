import type { Page } from "@playwright/test";
import { editor, expect, publishInEditor, readJson, test, writeSiteFile } from "./helpers.js";

test.use({ timezoneId: "America/New_York" });

/** A date in New York, as `YYYY-MM-DD`, some days from today. */
function dateFromToday(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(date);
}

function nextMonth(date: string): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** A visible control in the item editor's sidebar; Puck renders hidden copies of its fields. */
function sidebar(page: Page, label: string) {
  return editor(page).getByLabel(label, { exact: true }).filter({ visible: true }).first();
}

test("creates a collection of events, adds a weekly one, and shows it in calendars", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto("/admin#/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Events", { exact: true }).check();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Events");
  await expect(page.getByLabel("One item is called")).toHaveValue("Event");
  // A site without a time zone gets this computer's.
  await expect(page.getByText("The site's time zone will be set to America/New York.")).toBeVisible();
  await page.getByRole("button", { name: "Create collection" }).click();

  await expect(page).toHaveURL(/#\/collections\/events$/);
  expect(readJson("content/collections/events/_collection.json")).toMatchObject({
    fields: expect.arrayContaining([{ name: "when", label: "Date and time", type: "event", required: true }]),
    calendar: { when: "when", place: "place", summary: "summary" },
  });
  expect(readJson("content/site.json")).toMatchObject({ timeZone: "America/New_York" });

  await page.getByRole("button", { name: "Add event" }).click();
  await page.getByLabel("Title").fill("Choir practice");
  await page.getByRole("dialog").getByRole("button", { name: "Add event" }).click();
  await expect(page).toHaveURL(/edit\?slug=choir-practice$/);

  const start = dateFromToday(0);
  const skipped = dateFromToday(7);
  await sidebar(page, "Starts").fill(start);
  await sidebar(page, "Time").fill("19:30");
  // A select's label includes its options' text, so it's found by its accessible name.
  await editor(page).getByRole("combobox", { name: "Repeats" }).filter({ visible: true }).first().selectOption("week");
  await sidebar(page, "A date it doesn't happen").fill(skipped);
  await editor(page).getByRole("button", { name: "Skip this date" }).filter({ visible: true }).click();
  // Its name includes its hint.
  await editor(page)
    .getByRole("textbox", { name: /^Place/ })
    .filter({ visible: true })
    .first()
    .fill("Choir loft");
  await expect(
    editor(page)
      .getByText(/^Next: /)
      .filter({ visible: true }),
  ).toContainText("7:30 PM");
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/collections/events/choir-practice.json")).toEqual({
    version: 1,
    fields: {
      title: "Choir practice",
      when: { start: `${start}T19:30`, repeat: { every: "week", skip: [skipped] } },
      place: "Choir loft",
    },
  });

  // A page with a month at a time gets a page for each month, and the collection a file to subscribe to.
  writeSiteFile(
    "content/pages/calendar.json",
    `${JSON.stringify({
      version: 1,
      data: {
        root: { props: { title: "Calendar" } },
        content: [
          {
            type: "Calendar",
            props: {
              id: "Calendar-1",
              collection: "events",
              view: "month",
              monthsBefore: 1,
              monthsAfter: 2,
              className: "",
            },
          },
        ],
      },
    })}\n`,
  );
  const calendar = await (await request.get("/calendar")).text();
  expect(calendar).toContain("Choir practice");
  expect(calendar).toContain(`href="/calendar/${nextMonth(start)}"`);
  const following = await request.get(`/calendar/${nextMonth(start)}`);
  expect(following.status()).toBe(200);
  expect(await following.text()).toContain("<title>Calendar: ");

  const feed = await request.get("/calendars/events.ics");
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const text = await feed.text();
  expect(text).toContain("SUMMARY:Choir practice");
  expect(text).toContain("RRULE:FREQ=WEEKLY");
  expect(text).toContain(`EXDATE;TZID=America/New_York:${skipped.replace(/-/g, "")}T193000`);

  const entry = await (await request.get("/events/choir-practice")).text();
  expect(entry).toContain("Add to calendar");
  expect(entry).toContain('href="/calendars/events/choir-practice.ics"');
});

test("sets the site's time zone", async ({ page }) => {
  await page.goto("/admin#/settings");
  await page.getByLabel("Time zone").selectOption("Europe/London");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({ timeZone: "Europe/London" });
});
