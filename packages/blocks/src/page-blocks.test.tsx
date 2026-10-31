import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { announcementHash, announcementShown } from "./announcement-data.js";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

function site(header: unknown[] = []): SiteContent {
  return {
    settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph", url: "https://parish.example.org" }),
    menus: {},
    header: { version: 1, data: { root: {}, content: header } } as SiteContent["header"],
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };
}

function block(type: keyof typeof blocks, id: string, props: Record<string, unknown> = {}) {
  return { type, props: { id, ...blocks[type].defaultProps, ...props } };
}

async function render(content: unknown[], header: unknown[] = []) {
  const page: Page = {
    path: "/visit",
    file: "content/pages/visit.json",
    content: { version: 1, data: { root: { props: { title: "Visit us" } }, content } },
  } as Page;
  return renderPage(site(header), page);
}

function structuredData(html: string): Array<Record<string, unknown>> {
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!match?.[1]) return [];
  const { "@context": _, "@graph": graph, ...item } = JSON.parse(match[1]);
  return graph ?? [item];
}

describe("Questions and answers", () => {
  it("shows each question with its answer, and tells search engines about every FAQ on the page as one", async () => {
    const html = await render([
      block("Faq", "f1", {
        heading: "Visiting",
        items: [
          { question: "Where do I park?", answer: "<p>Behind the <strong>hall</strong>.</p>" },
          { question: "", answer: "<p>Left out</p>" },
        ],
      }),
      block("Faq", "f2", { heading: "", items: [{ question: "Is there a nursery?", answer: "<p>Yes.</p>" }] }),
    ]);
    expect(html).toMatch(/<h2[^>]*>Visiting<\/h2>/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Where do I park\?<\/summary>/);
    expect(html).toContain("Behind the <strong>hall</strong>.");
    expect(html).not.toContain("Left out");
    const faq = structuredData(html).filter((item) => item["@type"] === "FAQPage");
    expect(faq).toEqual([
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Where do I park?",
            acceptedAnswer: { "@type": "Answer", text: "Behind the hall." },
          },
          { "@type": "Question", name: "Is there a nursery?", acceptedAnswer: { "@type": "Answer", text: "Yes." } },
        ],
      },
    ]);
  });
});

describe("Headings and On this page", () => {
  it("gives headings link names of their own, which On this page lists on any page", async () => {
    const html = await render([
      block("OnThisPage", "toc", { depth: "2", sticky: true }),
      block("Heading", "h1", { text: "Mass times", level: "h2" }),
      block("Heading", "h2", { text: "Mass times", level: "h2" }),
      block("Heading", "h3", { text: "Parking", level: "h3", anchor: "car-park" }),
      block("Heading", "h4", { text: "Getting here", level: "h2", anchor: "directions" }),
    ]);
    expect(html).toMatch(/<h2 [^>]*id="mass-times"[^>]*>Mass times<\/h2>/);
    expect(html).toMatch(/<h2 [^>]*id="mass-times-2"[^>]*>Mass times<\/h2>/);
    expect(html).toMatch(/<h3 [^>]*id="car-park"[^>]*>Parking<\/h3>/);
    const nav = html.slice(html.indexOf('<nav aria-label="On this page"'), html.indexOf("</nav>"));
    expect(nav).toContain("sticky");
    expect(nav).toContain('href="#mass-times-2"');
    expect(nav).toContain('href="#directions"');
    // Only the main headings, as asked.
    expect(nav).not.toContain("#car-park");
  });
});

describe("Announcement bar", () => {
  it("shows between its first and last days, saying when that changes", () => {
    expect(announcementShown({ showFrom: "2026-12-20", hideAfter: "2027-01-06" }, "2026-12-01")).toEqual({
      shown: false,
      changes: "2026-12-20",
    });
    expect(announcementShown({ showFrom: "2026-12-20", hideAfter: "2027-01-06" }, "2026-12-25")).toEqual({
      shown: true,
      changes: "2027-01-07",
    });
    expect(announcementShown({ hideAfter: "2027-01-06" }, "2027-01-07")).toEqual({ shown: false });
    expect(announcementShown({ showFrom: "someday" }, "2026-12-01")).toEqual({ shown: true });
  });

  it("renders in the header, with what hides it for visitors who closed it before it", async () => {
    const message = "Christmas Mass times are here";
    const html = await render(
      [],
      [block("AnnouncementBar", "a", { message, href: "/christmas", linkLabel: "See them", closable: true })],
    );
    const hash = announcementHash(message, "/christmas");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    const bar = html.indexOf(`data-gf-announcement="${hash}"`);
    expect(bar).toBeGreaterThan(0);
    // The script before the bar hides it as the page is read, and the one at the end makes Close work.
    expect(html.lastIndexOf("__gfAnnouncementHidden", bar)).toBeGreaterThan(0);
    expect(html.indexOf("__gfAnnouncement=1")).toBeGreaterThan(bar);
    expect(html).toContain('href="/christmas/"');

    const lasting = await render([], [block("AnnouncementBar", "a", { message, closable: false })]);
    expect(lasting).toContain(message);
    expect(lasting).not.toContain("__gfAnnouncement");
    const over = await render([], [block("AnnouncementBar", "a", { message, hideAfter: "2020-01-01" })]);
    expect(over).not.toContain(message);
  });
});

describe("Table", () => {
  it("shows formatted cells, and older tables' plain text as it was typed", async () => {
    const html = await render([
      block("Table", "t", {
        cells: [
          ["Day", "Time"],
          ['<strong>Sunday</strong> <a href="/mass">Mass</a><script>x()</script>', "9:00<br>10:30"],
        ],
      }),
      block("Table", "old", {
        format: undefined,
        cells: [
          ["Item", "Price"],
          ["Fish & chips <large>", "£5"],
        ],
      }),
    ]);
    expect(html).toContain('<strong>Sunday</strong> <a href="/mass/">Mass</a></td>');
    expect(html).toContain("9:00<br>10:30");
    expect(html).not.toContain("x()");
    expect(html).toContain("Fish &amp; chips &lt;large&gt;");
  });

  it("turns an older table's plain text into formatted text once it changes, not as the editor opens it", async () => {
    const resolve = blocks.Table.resolveData;
    if (!resolve) throw new Error("The Table block resolves its data.");
    const old = {
      type: "Table",
      props: { ...blocks.Table.defaultProps, id: "t", format: undefined, cells: [["A & B", "<1"]] },
    };
    const call = (data: typeof old, trigger: string, lastData: typeof old | null = old) =>
      resolve(data as never, { changed: {}, lastData, metadata: {}, trigger, parent: null } as never);
    expect((await call(old, "load")).props).toEqual(old.props);
    // A cell edited in the editor's formatted boxes is formatted already; the rest are escaped.
    const edited = { ...old, props: { ...old.props, cells: [["<strong>A</strong> &amp; B", "<1"]] } };
    expect((await call(edited, "replace")).props).toMatchObject({
      format: "html",
      cells: [["<strong>A</strong> &amp; B", "&lt;1"]],
    });
    // Where pages are built, with nothing before, every cell is plain text.
    expect((await call(old, "force", null)).props).toMatchObject({ format: "html", cells: [["A &amp; B", "&lt;1"]] });
  });
});
