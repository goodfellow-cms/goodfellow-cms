import {
  type Collection,
  collectionFileSchema,
  type GoodfellowConfig,
  type Page,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { lazy, Suspense } from "react";
import { describe, expect, it } from "vitest";
import { createPageRenderer } from "./server.js";
import { useSite } from "./site-context.js";

function EntryDate() {
  const { entry } = useSite();
  return <time>{String(entry?.content.fields.date)}</time>;
}

function CurrentPath() {
  const { path, settings } = useSite();
  return (
    <span>
      {settings.title} at {path}
    </span>
  );
}

const resolved: ComponentConfig<{ text: string }> = {
  fields: { text: { type: "text" } },
  resolveData: async ({ props }) => ({ props: { ...props, text: `resolved ${props.text}` } }),
  render: ({ text }) => <p>{text}</p>,
};

const config: GoodfellowConfig = {
  blocks: {
    Heading: {
      fields: { text: { type: "text" } },
      render: ({ text }) => <h1>{text}</h1>,
    },
    Body: {
      fields: { body: { type: "richtext" } },
      render: ({ body }) => <div className="body">{body}</div>,
    },
    Where: { render: () => <CurrentPath /> },
    EntryDate: { render: () => <EntryDate /> },
    Resolved: resolved,
  },
};

const settings = siteSettingsSchema.parse({
  version: 1,
  title: "St. Joseph",
  url: "https://example.org",
  titleTemplate: "%s | St. Joseph",
  socialImage: "/media/share.png",
  theme: { colors: { primary: "#1e3a8a" }, fonts: { heading: "Cinzel" } },
});

function makeContent(overrides: Partial<SiteContent> = {}): SiteContent {
  return {
    settings,
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
    ...overrides,
  };
}

function makePage(content: unknown[], rootProps: Record<string, unknown> = {}, path = "/about"): Page {
  return {
    path,
    file: "content/pages/about.json",
    content: {
      version: 1,
      data: { root: { props: rootProps }, content: content as Page["content"]["data"]["content"] },
    },
  };
}

const renderPage = createPageRenderer(config);

/** The first page rendered loads React's and Puck's renderers, which can take seconds on Windows while many tests run at once. */
const RENDER_TIMEOUT = 30_000;

describe("renderPage", { timeout: RENDER_TIMEOUT }, () => {
  it("renders a complete document with head tags and theme", async () => {
    const html = await renderPage(
      makeContent(),
      makePage([{ type: "Heading", props: { id: "h", text: "About us" } }], {
        title: "About",
        className: "page-about",
      }),
      { stylesheets: ["/assets/site.css"] },
    );

    expect(html.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
    expect(html).toContain("<title>About | St. Joseph</title>");
    expect(html).toContain('<link rel="canonical" href="https://example.org/about"/>');
    expect(html).toContain('<meta property="og:image" content="https://example.org/media/share.png"/>');
    expect(html).toContain('<link rel="stylesheet" href="/assets/site.css"/>');
    expect(html).toContain("family=Cinzel:wght@");
    expect(html).toContain("--primary:#1e3a8a");
    expect(html).toContain(
      '<main class="gf-main page-about" data-pagefind-body=""><div><h1>About us</h1></div></main>',
    );
    expect(html).not.toContain("<header");
  });

  it("writes a long page whole, with what a block waited for in its place, never moved to the end", async () => {
    // A component that loads a moment later, as Puck's rich text does.
    const Late = lazy(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Over 500 bytes, which React would move.
      return { default: () => <p>Loaded late. {"Text that came later. ".repeat(40)}</p> };
    });
    const Waits: ComponentConfig = {
      render: () => (
        <Suspense fallback={null}>
          <Late />
        </Suspense>
      ),
    };
    const render = createPageRenderer({ blocks: { ...config.blocks, Waits } });
    // Past React's 12.8 kB chunks, after which it would move the late part to the end of the page.
    const long = Array.from({ length: 40 }, (_, index) => ({
      type: "Heading",
      props: { id: `h${index}`, text: "A heading long enough to make the page long. ".repeat(10) },
    }));
    const html = await render(makeContent(), makePage([...long, { type: "Waits", props: { id: "w" } }]));
    expect(html.length).toBeGreaterThan(20_000);
    expect(html).not.toContain('hidden id="S:');
    expect(html.indexOf("Loaded late")).toBeLessThan(html.indexOf("</main>"));
  });

  it("lists the credits of the photos a page shows at the end of its content", async () => {
    const Photo: ComponentConfig<{ src: string }> = { render: ({ src }) => <img src={src} alt="" /> };
    const render = createPageRenderer({ blocks: { ...config.blocks, Photo } });
    const credits = {
      "/media/choir.jpg": {
        title: "Choir",
        creator: "Ann Example",
        creatorUrl: "https://www.flickr.com/people/ann",
        source: "Flickr",
        sourceUrl: "https://www.flickr.com/photos/ann/1",
        license: "CC BY 2.0",
        licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
      },
      "/media/unused.jpg": { title: "Unused", creator: "", source: "", license: "CC0 1.0" },
    };
    const html = await render(
      makeContent({ credits, settings: { ...settings, externalLinksInNewTab: true } }),
      makePage([{ type: "Photo", props: { id: "p", src: "/media/choir.jpg" } }]),
    );
    expect(html).toContain(
      '<div class="gf-credits" data-pagefind-ignore=""><ul><li><a href="https://www.flickr.com/photos/ann/1" rel="noopener" target="_blank">Choir</a> · <a href="https://www.flickr.com/people/ann" rel="noopener" target="_blank">Ann Example</a> · Flickr · <a href="https://creativecommons.org/licenses/by/2.0/" rel="license noopener" target="_blank">CC BY 2.0</a></li></ul></div></main>',
    );
    expect(html).not.toContain("Unused");
    // A page without credited photos has no list.
    expect(await render(makeContent({ credits }), makePage([]))).not.toContain("gf-credits");
  });

  it("adds the site's own code to the head and the end of the body", async () => {
    const html = await renderPage(
      makeContent({
        code: {
          head: '<!-- Analytics -->\n<script async src="https://example.org/tag.js?id=1&amp;x=2"></script>\n<script>window.n = 1 < 2;</script>\n<meta name="verify" content="abc">',
          body: '<noscript><iframe src="https://example.org/ns"></iframe></noscript>',
        },
      }),
      makePage([]),
    );
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain('<script async="" src="https://example.org/tag.js?id=1&amp;x=2"></script>');
    expect(head).toContain("<script>window.n = 1 < 2;</script>");
    expect(head).toContain('<meta name="verify" content="abc"/>');
    expect(html).toContain(
      '<div data-goodfellow-code="" style="display:contents"><noscript><iframe src="https://example.org/ns"></iframe></noscript></div></body>',
    );
    // Code that doesn't belong in the head is left out (the admin panel won't publish it).
    const wrong = await renderPage(makeContent({ code: { head: "<div>Hi</div>", body: "" } }), makePage([]));
    expect(wrong).not.toContain("<div>Hi</div>");
  });

  it("renders the header and footer around the page", async () => {
    const html = await renderPage(
      makeContent({
        header: { version: 1, data: { root: {}, content: [{ type: "Where", props: { id: "w" } }] } },
        footer: { version: 1, data: { root: {}, content: [{ type: "Heading", props: { id: "f", text: "Bye" } }] } },
      }),
      makePage([]),
    );
    expect(html).toMatch(
      /<header class="gf-header"><div><span>St. Joseph<!-- --> at <!-- -->\/about<\/span><\/div><\/header><main/,
    );
    expect(html).toContain('<footer class="gf-footer"><div><h1>Bye</h1></div></footer>');
  });

  it("wraps blocks in their CSS classes only when set", async () => {
    const html = await renderPage(
      makeContent(),
      makePage([
        { type: "Heading", props: { id: "a", text: "Plain" } },
        { type: "Heading", props: { id: "b", text: "Styled", className: "text-center mt-4" } },
      ]),
    );
    expect(html).toContain(
      '<main class="gf-main" data-pagefind-body=""><div><h1>Plain</h1><div class="text-center mt-4"><h1>Styled</h1></div></div></main>',
    );
  });

  it("runs resolveData before rendering", async () => {
    const html = await renderPage(makeContent(), makePage([{ type: "Resolved", props: { id: "r", text: "text" } }]));
    expect(html).toContain("<p>resolved text</p>");
  });

  it("renders rich text without scripts, event handlers or javascript: links", async () => {
    const body =
      '<p onclick="steal()">Hello <strong>world</strong><script>alert(1)</script></p>' +
      '<p><a href="javascript:alert(1)">bad</a> <a href="/about">good</a></p><img src=x onerror=alert(1)>';
    const html = await renderPage(makeContent(), makePage([{ type: "Body", props: { id: "b", body } }]));

    expect(html).toContain("Hello <strong>world</strong>");
    expect(html).toContain('href="/about"');
    expect(html).not.toMatch(/<script|onclick|onerror|javascript:/i);
  });

  it("opens rich text's links in the same tab, or other sites' in a new tab if the settings say so", async () => {
    const body = '<p><a href="https://github.com">GitHub</a> and <a href="/about">About</a></p>';
    const page = makePage([{ type: "Body", props: { id: "b", body } }]);
    const newTabs = await renderPage(makeContent({ settings: { ...settings, externalLinksInNewTab: true } }), page);
    expect(newTabs).toContain('<a target="_blank" rel="noopener noreferrer" href="https://github.com">GitHub</a>');
    expect(newTabs).toContain('<a target="_self" rel="" href="/about">About</a>');
    // Puck would open every link in a new tab, marked nofollow, without a target of its own.
    const sameTabs = await renderPage(makeContent(), page);
    expect(sameTabs).toContain('<a target="_self" rel="" href="https://github.com">GitHub</a>');
    expect(sameTabs).not.toContain("nofollow");
  });

  it("renders an entry's page from its collection's template", async () => {
    const videos: Collection = {
      id: "videos",
      file: "content/collections/videos/_collection.json",
      settings: collectionFileSchema.parse({
        version: 1,
        name: "Videos",
        entryName: "Video",
        path: "/videos/{slug}",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "date", label: "Date", type: "date" },
          { name: "body", label: "Text", type: "richtext" },
        ],
        template: {
          root: { props: { title: "{title}", description: "Recorded {date}" } },
          content: [
            { type: "Heading", props: { id: "h", text: "{title} {unknown}" } },
            { type: "Body", props: { id: "b", body: "<p>Watch {title}</p>" } },
            { type: "EntryDate", props: { id: "d" } },
          ],
        },
      }),
      entries: [
        {
          collection: "videos",
          slug: "easter",
          file: "content/collections/videos/easter.json",
          path: "/videos/easter",
          content: { version: 1, fields: { title: "Easter <Vigil>", date: "2026-04-04" } },
        },
      ],
    };
    const html = await renderPage(makeContent({ collections: [videos] }), {
      path: "/videos/easter",
      file: "content/collections/videos/easter.json",
      content: { version: 1, data: videos.settings.template },
      entry: { collection: "videos", slug: "easter" },
    });

    expect(html).toContain("<title>Easter &lt;Vigil&gt; | St. Joseph</title>");
    expect(html).toContain('<meta name="description" content="Recorded April 4, 2026"/>');
    expect(html).toContain("<h1>Easter &lt;Vigil&gt; {unknown}</h1>");
    expect(html).toContain("<p>Watch Easter &lt;Vigil&gt;</p>");
    expect(html).toContain("<time>2026-04-04</time>");
  });
});
