import {
  CODE_THEMES,
  type Collection,
  collectionFileSchema,
  type Entry,
  type Page,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { createPuckConfig } from "@goodfellow-cms/react";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { CODE_THEME_LOADERS } from "./highlight.js";
import { blocks, categories, listedEntries } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const events: Collection = {
  id: "events",
  file: "content/collections/events/_collection.json",
  settings: collectionFileSchema.parse({
    version: 1,
    name: "Events",
    entryName: "Event",
    path: "/events/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "date", label: "Date", type: "date" },
      { name: "photo", label: "Photo", type: "image" },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "body", label: "Text", type: "richtext" },
    ],
    sort: { field: "date", order: "asc" },
    template: {
      root: { props: { title: "{title}" } },
      content: [
        { type: "EntryField", props: { id: "t", field: "title", style: "title", className: "" } },
        { type: "EntryField", props: { id: "d", field: "date", style: "small", className: "" } },
        { type: "EntryField", props: { id: "b", field: "body", style: "text", className: "" } },
        { type: "EntryField", props: { id: "p", field: "photo", style: "text", className: "" } },
      ],
    },
  }),
  entries: [
    ["picnic", "Parish picnic", "2026-07-12", "Food & games"],
    ["fish-fry", "Fish fry", "2026-03-06", ""],
    ["undated", "Undated", undefined, ""],
  ].map(([slug, title, date, summary]) => ({
    collection: "events",
    slug: slug as string,
    file: `content/collections/events/${slug}.json`,
    path: `/events/${slug}`,
    content: {
      version: 1,
      fields: {
        title,
        ...(date && { date }),
        summary,
        body: "<p>Join us <script>alert(1)</script></p>",
        ...(slug === "picnic" && { photo: "/media/picnic.jpg" }),
      },
    },
  })),
};

const content: SiteContent = {
  settings: siteSettingsSchema.parse({
    version: 1,
    title: "St. Joseph",
    logo: { src: "/media/logo.svg", alt: "Logo" },
  }),
  menus: {
    main: [
      { label: "Home", href: "/" },
      { label: "About", href: "/about", children: [{ label: "Staff", href: "/about/staff" }] },
    ],
  },
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [events],
  customCss: "",
};

function render(blocksData: unknown[], path = "/about/staff") {
  const page = {
    path,
    file: "",
    content: { version: 1, data: { root: { props: {} }, content: blocksData } },
  } as Page;
  return renderPage(content, page).then((html) => html.slice(html.indexOf("<main"), html.indexOf("</main>")));
}

describe("built-in blocks", () => {
  it("lists every block in a category", () => {
    const categorized = Object.values(categories).flatMap((category) => category.components);
    expect(categorized.sort()).toEqual(Object.keys(blocks).sort());
  });

  it("renders a section with nested columns and applies CSS classes to the block itself", async () => {
    const html = await render([
      {
        type: "Section",
        props: {
          id: "s",
          width: "narrow",
          padding: "lg",
          background: "primary",
          backgroundImage: "",
          className: "hero",
          content: [
            {
              type: "Grid",
              props: {
                id: "g",
                columns: "3",
                gap: "sm",
                className: "",
                items: [
                  {
                    type: "Heading",
                    props: { id: "h", text: "Hi", level: "h1", align: "center", className: "text-red-500" },
                  },
                ],
              },
            },
          ],
        },
      },
    ]);

    expect(html).toContain('<section class="py-20 bg-primary text-primary-foreground hero">');
    expect(html).toContain('class="mx-auto px-4 max-w-2xl"');
    expect(html).toContain('class="grid grid-cols-1 md:grid-cols-3 gap-3"');
    expect(html).toMatch(/<h1 class="[^"]*text-center text-red-500">Hi<\/h1>/);
    expect(html).not.toContain('<div class="hero"');
  });

  it("renders a menu from site data and marks the current page", async () => {
    const html = await render([
      { type: "Menu", props: { id: "m", menu: "main", orientation: "horizontal", className: "" } },
    ]);
    expect(html).toContain('<nav aria-label="main" data-gf-menu="">');
    // The current page's section, and the page itself, which is the current one.
    expect(html).toMatch(/href="\/about" class="[^"]*data-current:font-semibold" data-current="">/);
    expect(html).toMatch(/href="\/about\/staff" class="[^"]*" data-current="" aria-current="page">/);
    expect(html).not.toMatch(/href="\/" class="[^"]*" data-current/);
  });

  it("renders nothing for a menu that doesn't exist", async () => {
    const html = await render([
      { type: "Menu", props: { id: "m", menu: "missing", orientation: "horizontal", className: "" } },
    ]);
    expect(html).not.toContain("<nav");
  });

  it("shows the site logo and name", async () => {
    const html = await render([{ type: "SiteBrand", props: { id: "b", show: "both", className: "" } }]);
    // Beside the name, the logo is only decoration.
    expect(html).toContain(
      '<img src="/media/logo.svg" alt="" aria-hidden="true" class="h-10 w-auto"/><span>St. Joseph</span>',
    );
  });

  it("shows the dark logo in dark mode, only where the site has dark mode", async () => {
    const saved = content.settings;
    const logo = { src: "/media/logo.svg", alt: "Logo", darkSrc: "/media/logo-light.svg" };
    content.settings = { ...saved, logo };
    try {
      const brand = [{ type: "SiteBrand", props: { id: "b", show: "logo", className: "" } }];
      // Without dark mode, the dark logo is kept but not shown.
      expect(await render(brand)).not.toContain("logo-light.svg");
      content.settings = { ...saved, logo, theme: { ...saved.theme, darkMode: true } };
      const html = await render(brand);
      expect(html).toContain('<img src="/media/logo.svg" alt="Logo" class="h-10 w-auto dark:hidden"/>');
      expect(html).toContain('<img src="/media/logo-light.svg" alt="Logo" class="hidden h-10 w-auto dark:block"/>');
    } finally {
      content.settings = saved;
    }
  });

  it("colors code like the page by default, with Shiki's dark colors on sites with dark mode", async () => {
    const code = { id: "c", code: "let a = 1;", language: "javascript", title: "", copyLabel: "", className: "" };
    const light = await render([{ type: "Code", props: { ...code, colors: "page" } }]);
    expect(light).toContain('class="shiki github-light"');
    expect(light).not.toContain("--shiki-dark:");
    const saved = content.settings;
    content.settings = { ...saved, theme: { ...saved.theme, darkMode: true } };
    try {
      const page = await render([{ type: "Code", props: { ...code, colors: "page" } }]);
      expect(page).toContain('class="shiki shiki-themes github-light github-dark"');
      expect(page).toContain("--shiki-dark:");
    } finally {
      content.settings = saved;
    }
    const dark = await render([{ type: "Code", props: { ...code, colors: "dark" } }]);
    expect(dark).toContain('class="shiki github-dark"');
    expect(dark).not.toContain("--shiki-dark:");
    expect(blocks.Code.defaultProps?.colors).toBe("page");
  });

  it("shows the Dark mode switch only on sites with dark mode, as a switch or a menu", async () => {
    const props = { ...blocks.DarkModeSwitch.defaultProps, id: "s" };
    expect(await render([{ type: "DarkModeSwitch", props }])).not.toContain('role="switch"');
    const saved = content.settings;
    content.settings = { ...saved, theme: { ...saved.theme, darkMode: true } };
    try {
      const toggle = await render([{ type: "DarkModeSwitch", props }]);
      expect(toggle).toMatch(/<button type="button" role="switch" aria-checked="false" aria-label="Dark mode"/);
      expect(toggle).not.toContain(">Light</span>");
      const labelled = await render([{ type: "DarkModeSwitch", props: { ...props, labels: "show" } }]);
      expect(labelled).toContain(">Light</span>");
      expect(labelled).toContain(">Dark</span>");
      const menu = await render([
        { type: "DarkModeSwitch", props: { ...props, display: "menu", systemLabel: "Like my phone" } },
      ]);
      expect(menu).toMatch(/<select aria-label="Dark mode"[^>]*>/);
      expect(menu).toContain('<option value="light">Light</option>');
      expect(menu).toContain('<option value="system" selected="">Like my phone</option>');
    } finally {
      content.settings = saved;
    }
  });

  it("shows the site's contact details, linking the phone number and email address", async () => {
    const saved = content.settings;
    content.settings = {
      ...saved,
      contact: { address: "1 Church Street\nAnytown", phone: "(555) 010-0100", email: "office@example.org" },
    };
    try {
      const html = await render([
        {
          type: "ContactDetails",
          props: { id: "c", address: true, phone: true, email: false, layout: "stacked", className: "" },
        },
      ]);
      expect(html).toContain('<address class="whitespace-pre-line not-italic">1 Church Street\nAnytown</address>');
      expect(html).toContain('href="tel:5550100100"');
      expect(html).not.toContain("office@example.org");
    } finally {
      content.settings = saved;
    }
  });

  it("opens buttons in a new tab safely", async () => {
    const html = await render([
      {
        type: "Button",
        props: {
          id: "b",
          label: "Give",
          href: "https://example.org",
          variant: "primary",
          size: "md",
          newTab: true,
          className: "",
        },
      },
    ]);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("hides images that are only decoration from screen readers", async () => {
    const image = (decorative: boolean) => ({
      type: "Image",
      props: {
        id: "i",
        src: "/media/border.svg",
        alt: "A border",
        decorative,
        caption: "",
        aspect: "auto",
        rounded: false,
        className: "",
      },
    });
    expect(await render([image(false)])).toContain('<img src="/media/border.svg" alt="A border" loading="lazy"');
    expect(await render([image(true)])).toContain(
      '<img src="/media/border.svg" alt="" aria-hidden="true" loading="lazy"',
    );
  });

  it("lists a collection's entries as cards linking to their pages", async () => {
    const html = await render([
      {
        type: "CollectionList",
        props: {
          id: "l",
          collection: "events",
          layout: "cards",
          columns: "3",
          imageField: "photo",
          dateField: "date",
          summaryField: "summary",
          order: "newest",
          show: "all",
          limit: 2,
          emptyText: "",
          className: "",
        },
      },
    ]);
    expect(html).toContain('<ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">');
    expect(html.indexOf("Parish picnic")).toBeLessThan(html.indexOf("Fish fry"));
    expect(html).not.toContain("Undated");
    expect(html).toContain(
      '<img src="/media/picnic.jpg" alt="" aria-hidden="true" loading="lazy" class="aspect-video w-full object-cover"/>',
    );
    expect(html).toContain('<time dateTime="2026-07-12" class="text-sm text-muted-foreground">July 12, 2026</time>');
    expect(html).toContain(
      '<a href="/events/picnic" class="after:absolute after:inset-0 hover:underline">Parish picnic</a>',
    );
    expect(html).toContain("Food &amp; games");
  });

  it("shows the empty text when nothing matches", async () => {
    const html = await render([
      {
        type: "CollectionList",
        props: {
          id: "l",
          collection: "events",
          layout: "list",
          columns: "3",
          imageField: "",
          dateField: "date",
          summaryField: "",
          order: "default",
          show: "upcoming",
          limit: 0,
          emptyText: "No events planned",
          className: "",
        },
      },
    ]);
    // Every event in the fixture is in the past.
    expect(html).toContain('<p class="text-muted-foreground">No events planned</p>');
  });

  it("filters and orders entries by date", () => {
    const options = { dateField: "date", order: "default", show: "upcoming", limit: 0 } as const;
    expect(listedEntries(events, options, "2026-05-01").map((e) => e.slug)).toEqual(["picnic"]);
    expect(listedEntries(events, { ...options, show: "past" }, "2026-05-01").map((e) => e.slug)).toEqual(["fish-fry"]);
    expect(listedEntries(events, { ...options, show: "all" }).map((e) => e.slug)).toEqual([
      "fish-fry",
      "picnic",
      "undated",
    ]);
    expect(listedEntries(events, { ...options, show: "all", order: "title" }).map((e) => e.slug)).toEqual([
      "fish-fry",
      "picnic",
      "undated",
    ]);
  });

  it("renders an entry's fields in its template, with rich text sanitized", async () => {
    const picnic = events.entries[0];
    const html = await renderPage(content, {
      path: "/events/picnic",
      file: picnic?.file ?? "",
      content: { version: 1, data: events.settings.template },
      entry: { collection: "events", slug: "picnic" },
    });
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toMatch(/<h1 class="text-4xl[^"]*">Parish picnic<\/h1>/);
    expect(main).toContain(
      '<p class="text-sm text-muted-foreground"><time dateTime="2026-07-12">July 12, 2026</time></p>',
    );
    expect(main).toContain("Join us");
    expect(main).not.toContain("<script");
    expect(main).toContain('<img src="/media/picnic.jpg" alt="Parish picnic" class="w-full rounded-lg"/>');
  });

  it("highlights code when the page is built, escaping it", async () => {
    const html = await render([
      {
        type: "Code",
        props: {
          id: "c",
          code: '<b class="x">Hi</b>',
          language: "html",
          title: "index.html",
          colors: "dark",
          copyLabel: "Copy code",
          className: "",
        },
      },
    ]);
    expect(html).toContain('<pre class="shiki github-dark"');
    expect(html).toContain("&#x3C;");
    expect(html).not.toContain('<b class="x">');
    expect(html).toContain(">index.html</figcaption>");
    expect(html).toContain('aria-label="Copy code"');
  });

  it("colors code with the site's code themes, and its panel color when chosen", async () => {
    const code = { id: "c", code: "const a = 1;", language: "javascript", title: "", copyLabel: "", className: "" };
    const withTheme = (theme: object) =>
      renderPage({ ...content, settings: { ...content.settings, theme: { ...content.settings.theme, ...theme } } }, {
        path: "/",
        file: "",
        content: {
          version: 1,
          data: {
            root: { props: {} },
            content: [
              { type: "Code", props: { ...code, colors: "page" } },
              { type: "Code", props: { ...code, id: "d", colors: "dark" } },
            ],
          },
        },
      } as Page);
    const html = await withTheme({
      darkMode: true,
      code: { light: "everforest-light", dark: "everforest-dark", background: "site" },
    });
    expect(html).toMatch(
      /<pre class="shiki shiki-themes everforest-light everforest-dark" style="[^"]*background-color:var\(--muted\);--shiki-dark-bg:var\(--muted\)"/,
    );
    // Code that's always dark keeps its theme's background, which its colors are made for.
    expect(html).toMatch(/<pre class="shiki everforest-dark" style="background-color:#2d353b/);
    const plain = await withTheme({ code: { light: "vitesse-light" } });
    expect(plain).toMatch(/<pre class="shiki vitesse-light" style="background-color:#ffffff/);
  });

  it("can load every code theme Site Settings offers", async () => {
    const names = [...Object.keys(CODE_THEMES.light), ...Object.keys(CODE_THEMES.dark)];
    expect(Object.keys(CODE_THEME_LOADERS).sort()).toEqual([...names].sort());
    for (const name of names) {
      const theme = (await CODE_THEME_LOADERS[name as keyof typeof CODE_THEME_LOADERS]()).default;
      expect(theme.name).toBe(name);
      expect(theme.type).toBe(name in CODE_THEMES.light ? "light" : "dark");
    }
  });

  it("renders a Markdown file's body: tables, heading ids and highlighted code, with HTML shown as text", async () => {
    const docs: Collection = {
      id: "docs",
      file: "content/collections/docs/_collection.json",
      settings: collectionFileSchema.parse({
        version: 1,
        name: "Docs",
        entryName: "Page",
        path: "/docs/{slug}",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "body", label: "Text", type: "richtext" },
        ],
        markdown: { body: "body" },
        template: {
          root: { props: { title: "{title}" } },
          content: [
            { type: "EntryField", props: { id: "b", field: "body", style: "text", copyLabel: "Copy", className: "" } },
          ],
        },
      }),
      entries: [
        {
          collection: "docs",
          slug: "install",
          file: "content/collections/docs/install.md",
          path: "/docs/install",
          content: {
            version: 1,
            fields: {
              title: "Install",
              body: "## Install it\n\n```sh\nnpm i goodfellow\n```\n\n| Host | Free |\n|---|---|\n| GitLab | Yes |\n\n<script>alert(1)</script> [x](javascript:alert(1))",
            },
          },
        },
      ],
    };
    const html = await renderPage(
      { ...content, collections: [docs] },
      {
        path: "/docs/install",
        file: "content/collections/docs/install.md",
        content: { version: 1, data: docs.settings.template },
        entry: { collection: "docs", slug: "install" },
      },
    );
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toContain('<h2 id="install-it">Install it</h2>');
    expect(main).toContain("<td>GitLab</td>");
    // Light-only sites' code needs only the light colors.
    expect(main).toContain('<pre class="shiki github-light"');
    expect(main).toContain('aria-label="Copy"');
    expect(main).not.toMatch(/<script|href="javascript/);
  });

  it("builds a documentation page: navigation by section, headings on this page, previous and next", async () => {
    const doc = (slug: string, title: string, section: string, body: string): Entry => ({
      collection: "docs",
      slug,
      file: `content/collections/docs/${slug}.md`,
      path: `/docs/${slug}`,
      content: { version: 1, fields: { title, section, body } },
    });
    const docs: Collection = {
      id: "docs",
      file: "content/collections/docs/_collection.json",
      settings: collectionFileSchema.parse({
        version: 1,
        name: "Docs",
        entryName: "Page",
        path: "/docs/{slug}",
        fields: [
          { name: "title", label: "Title", type: "text" },
          {
            name: "section",
            label: "Section",
            type: "select",
            options: [
              { value: "start", label: "Getting started" },
              { value: "guides", label: "Guides" },
            ],
          },
          { name: "body", label: "Text", type: "richtext" },
        ],
        markdown: { body: "body" },
        template: {
          root: { props: { title: "{title}" } },
          content: [
            {
              type: "CollectionNav",
              props: { id: "n", collection: "", groupBy: "section", heading: "", className: "" },
            },
            { type: "OnThisPage", props: { id: "o", heading: "On this page", depth: "2", className: "" } },
            {
              type: "EntryPager",
              props: { id: "p", groupBy: "section", previousLabel: "Previous", nextLabel: "Next", className: "" },
            },
          ],
        },
      }),
      entries: [
        doc("intro", "Introduction", "start", "Hi"),
        doc("pages", "Pages", "guides", "Text"),
        doc("install", "Install", "start", "## Requirements\n\n### Node\n\n## Steps"),
      ],
    };
    const html = await renderPage(
      { ...content, collections: [docs] },
      {
        path: "/docs/install",
        file: "content/collections/docs/install.md",
        content: { version: 1, data: docs.settings.template },
        entry: { collection: "docs", slug: "install" },
      },
    );
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    // Grouped in the order of the choices, then in the collection's order.
    expect(main.indexOf(">Getting started<")).toBeLessThan(main.indexOf(">Guides<"));
    expect(main).toMatch(/aria-current="page"[^>]*>Install<\/a>/);
    expect(main.indexOf(">Introduction<")).toBeLessThan(main.indexOf(">Install<"));
    expect(main).toContain('href="#requirements"');
    expect(main).toContain('href="#steps"');
    expect(main).not.toContain('href="#node"');
    expect(main).toMatch(/href="\/docs\/intro" rel="prev"[^>]*>.*Introduction/);
    expect(main).toMatch(/href="\/docs\/pages" rel="next"[^>]*>.*Pages/);
  });

  it("leaves entry fields out of the page editor", () => {
    expect(Object.keys(createPuckConfig({ blocks, categories }, "page").components)).not.toContain("EntryField");
  });
});

describe("Search", () => {
  it("gives its box only its text, never Puck's functions, which Next.js can't send to the browser", () => {
    const element = blocks.Search.render({
      id: "Search-1",
      className: "",
      label: "Search the site",
      placeholder: "Search",
      noResults: "Nothing matches “{query}”.",
      unavailable: "Search works on the published site.",
      puck: { isEditing: false, renderDropZone: () => null, dragRef: null, metadata: {} },
      editMode: false,
    } as never) as { props: { children: { props: Record<string, unknown> } } };
    expect(element.props.children.props).toEqual({
      label: "Search the site",
      placeholder: "Search",
      noResults: "Nothing matches “{query}”.",
      unavailable: "Search works on the published site.",
    });
  });
});
