import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

function page(path: string, title: string, blocksData: unknown[] = []): Page {
  return { path, file: "", content: { version: 1, data: { root: { props: { title } }, content: blocksData } } } as Page;
}

const content: SiteContent = {
  settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph", description: "A parish in Springfield" }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [
    page("/", "Home"),
    page("/about", "About us"),
    page("/about/staff", "Staff"),
    page("/about/staff/clergy", "Clergy"),
    page("/visit/times", "Mass times"),
    page("/404", "Page not found"),
  ],
  collections: [],
  customCss: "",
};

async function render(blocksData: unknown[], path = "/about/staff") {
  const html = await renderPage(content, page(path, "Here", blocksData));
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

describe("WordPress's text blocks", () => {
  it("draws a separator in each of its styles", async () => {
    const html = await render([
      { type: "Separator", props: { id: "a", style: "default", className: "" } },
      { type: "Separator", props: { id: "b", style: "wide", className: "my-2" } },
      { type: "Separator", props: { id: "c", style: "dots", className: "" } },
    ]);
    expect(html).toContain('<hr class="gf-separator mx-auto my-8 w-24 border-0 border-t-2 border-border"/>');
    // An editor's spacing wins over the block's own.
    expect(html).toContain('<hr class="gf-separator w-full border-0 border-t border-border my-2"/>');
    expect(html).toMatch(/<hr class="gf-separator [^"]*bg-repeat-x[^"]*"\/>/);
  });

  it("shows a pullquote with who said it, and leaves the citation out when there's none", async () => {
    const html = await render([
      {
        type: "Pullquote",
        props: { id: "q", quote: "Be not afraid.", citation: "John Paul II", align: "center", className: "" },
      },
      { type: "Pullquote", props: { id: "r", quote: "Alone", citation: "", align: "left", className: "" } },
    ]);
    expect(html).toMatch(
      /<figure class="gf-pullquote [^"]*text-center"><blockquote class="gf-pullquote-quote[^"]*"><p>Be not afraid\.<\/p><\/blockquote><figcaption class="gf-pullquote-citation[^"]*">John Paul II<\/figcaption><\/figure>/,
    );
    expect(html).toMatch(/<p>Alone<\/p><\/blockquote><\/figure>/);
  });

  it("keeps preformatted text and verse as typed, escaped", async () => {
    const html = await render([
      { type: "Preformatted", props: { id: "p", text: "a  <b>\n  c", className: "" } },
      { type: "Verse", props: { id: "v", text: "Roses are red,\n  violets blue", className: "" } },
    ]);
    expect(html).toContain(">a  &lt;b&gt;\n  c</pre>");
    expect(html).toMatch(
      /<pre class="gf-verse \[font-family:inherit\] whitespace-pre-wrap">Roses are red,\n {2}violets blue<\/pre>/,
    );
  });

  it("opens details only when asked, with its blocks inside", async () => {
    const inner = [{ type: "Heading", props: { id: "h", text: "Inside", level: "h2", align: "left", className: "" } }];
    const closed = await render([
      { type: "Details", props: { id: "d", summary: "More", open: false, content: inner, className: "" } },
    ]);
    expect(closed).toMatch(
      /<details class="gf-details my-4"><summary class="gf-details-summary[^"]*">More<\/summary><div class="gf-details-content mt-3">.*Inside.*<\/div><\/details>/s,
    );
    const open = await render([
      { type: "Details", props: { id: "d", summary: "More", open: true, content: inner, className: "" } },
    ]);
    expect(open).toContain('<details open="" class="gf-details my-4">');
  });

  it("draws a table with headings, a footer, a caption and stripes", async () => {
    const html = await render([
      {
        type: "Table",
        props: {
          id: "t",
          cells: [["Day", "Time"], ["Sunday", "9:00 <am>"], ["Monday"], ["Total", "2"]],
          header: true,
          footer: true,
          caption: "Mass times",
          striped: true,
          className: "",
        },
      },
    ]);
    expect(html).toContain('<caption class="gf-table-caption');
    expect(html).toMatch(
      /<thead><tr class="gf-table-row"><th scope="col" class="gf-table-header-cell[^"]*">Day<\/th><th scope="col"[^>]*>Time<\/th><\/tr><\/thead>/,
    );
    expect(html).toContain("9:00 &lt;am&gt;");
    // A short row gets empty cells, so the columns line up.
    expect(html).toMatch(/>Monday<\/td><td class="gf-table-cell[^"]*"><\/td>/);
    expect(html).toMatch(/<tbody><tr class="gf-table-row even:bg-muted\/50">/);
    expect(html).toMatch(/<tfoot><tr class="gf-table-row"><td class="gf-table-cell[^"]*font-semibold">Total<\/td>/);
  });

  it("puts every row in the body without headings or a footer", async () => {
    const html = await render([
      {
        type: "Table",
        props: {
          id: "t",
          cells: [["a"], ["b"]],
          header: false,
          footer: false,
          caption: "",
          striped: false,
          className: "",
        },
      },
    ]);
    expect(html).not.toContain("<thead>");
    expect(html).not.toContain("<tfoot>");
    expect(html).not.toContain("<caption");
    expect(html.match(/<tr /g)).toHaveLength(2);
  });
});

describe("Page list", () => {
  it("lists the site's pages, nested by address, never Page not found", async () => {
    const html = await render([{ type: "PageList", props: { id: "l", parent: "", className: "" } }]);
    expect(html).not.toContain("Page not found");
    const titles = [...html.matchAll(/class="gf-page-list-link[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(titles).toEqual(["Home", "About us", "Staff", "Clergy", "Mass times"]);
    // Staff is under About us, and Clergy under Staff; Mass times has no page above it, so it's at the top.
    expect(html).toMatch(
      /About us<\/a><ul class="gf-page-list-children[^"]*"><li class="gf-page-list-item"><a href="\/about\/staff"/,
    );
    expect(html).toMatch(
      /href="\/about\/staff" aria-current="page" class="gf-page-list-link hover:underline font-semibold"/,
    );
  });

  it("lists only the pages under an address", async () => {
    const html = await render([{ type: "PageList", props: { id: "l", parent: "/about", className: "" } }]);
    const titles = [...html.matchAll(/class="gf-page-list-link[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(titles).toEqual(["Staff", "Clergy"]);
  });
});

describe("Site name and logo", () => {
  it("shows the site's description under its name when asked", async () => {
    const html = await render([{ type: "SiteBrand", props: { id: "b", show: "title", tagline: true, className: "" } }]);
    expect(html).toContain(
      '<span class="gf-site-brand-text flex flex-col"><span class="gf-site-brand-name">St. Joseph</span><span class="gf-site-brand-tagline font-body text-sm font-normal text-muted-foreground">A parish in Springfield</span></span>',
    );
    const plain = await render([{ type: "SiteBrand", props: { id: "b", show: "title", className: "" } }]);
    expect(plain).not.toContain("gf-site-brand-tagline");
  });
});

describe("Section's cover options", () => {
  it("puts a color over the background, keeps a part of the picture in view and sets a height", async () => {
    const html = await render([
      {
        type: "Section",
        props: {
          id: "s",
          content: [],
          width: "normal",
          padding: "md",
          background: "none",
          backgroundImage: "/media/church.jpg",
          overlay: "dark",
          overlayStrength: "strong",
          focus: "top",
          minHeight: "screen",
          className: "",
        },
      },
    ]);
    expect(html).toContain(
      '<section class="gf-section bg-cover bg-top relative isolate flex min-h-screen flex-col justify-center py-12 text-white"',
    );
    expect(html).toContain(
      '<span aria-hidden="true" class="gf-section-overlay absolute inset-0 -z-10 bg-black/70"></span>',
    );
  });

  it("draws sections stored before the cover options as they were", async () => {
    const html = await render([
      {
        type: "Section",
        props: {
          id: "s",
          content: [],
          width: "normal",
          padding: "md",
          background: "none",
          backgroundImage: "/media/church.jpg",
          className: "",
        },
      },
    ]);
    expect(html).toContain('<section class="gf-section bg-cover bg-center py-12"');
    expect(html).not.toContain("gf-section-overlay");
  });
});
