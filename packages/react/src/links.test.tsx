import { siteSettingsSchema } from "@goodfellow-cms/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteImage, SiteLink } from "./links.js";
import { SiteProvider } from "./site-context.js";
import type { SiteComponents, SiteContextValue } from "./site-types.js";

const site: SiteContextValue = {
  settings: siteSettingsSchema.parse({ version: 1 }),
  menus: {},
  path: "/",
  collections: [],
};

const render = (value: Partial<SiteContextValue>, element: React.ReactNode) =>
  renderToStaticMarkup(<SiteProvider value={{ ...site, ...value }}>{element}</SiteProvider>);

const components: SiteComponents = {
  Link: ({ href, children }) => (
    <a data-router="" href={href}>
      {children}
    </a>
  ),
  Image: ({ src, alt, width, height }) => <img data-sized="" src={src} alt={alt} width={width} height={height} />,
};

describe("SiteLink", () => {
  it("adds the base path to the site's own addresses only", () => {
    expect(render({ base: "/repo/" }, <SiteLink href="/about">About</SiteLink>)).toBe(
      '<a href="/repo/about/">About</a>',
    );
    expect(render({ base: "/repo/" }, <SiteLink href="https://example.org">X</SiteLink>)).toBe(
      '<a href="https://example.org">X</a>',
    );
  });

  it("uses the renderer's link component for pages, but not files or new tabs", () => {
    expect(render({ base: "/repo/", components }, <SiteLink href="/about">A</SiteLink>)).toBe(
      '<a data-router="" href="/about/">A</a>',
    );
    expect(render({ base: "/repo/", components }, <SiteLink href="/media/a.pdf">B</SiteLink>)).toBe(
      '<a href="/repo/media/a.pdf">B</a>',
    );
    expect(
      render(
        { components },
        <SiteLink href="/about" target="_blank">
          C
        </SiteLink>,
      ),
    ).toBe('<a href="/about/" target="_blank">C</a>');
  });

  it("leaves out addresses that would run code, keeping the link's words, and keeps calendar links", () => {
    for (const href of ["javascript:alert(1)", " java\tscript:alert(1)", "data:text/html,<script>x</script>"]) {
      expect(render({ components }, <SiteLink href={href}>Run</SiteLink>), href).toBe("<a>Run</a>");
    }
    expect(render({}, <SiteLink href="webcal://example.org/a.ics">Subscribe</SiteLink>)).toBe(
      '<a href="webcal://example.org/a.ics">Subscribe</a>',
    );
  });
});

describe("SiteLink with links to other sites in new tabs", () => {
  const settings = siteSettingsSchema.parse({ version: 1, url: "https://example.org", externalLinksInNewTab: true });

  it("opens other sites in a new tab, but not the site's own pages or links that say where they open", () => {
    expect(render({ settings }, <SiteLink href="https://github.com">G</SiteLink>)).toBe(
      '<a href="https://github.com" target="_blank" rel="noopener noreferrer">G</a>',
    );
    expect(render({ settings }, <SiteLink href="/about">A</SiteLink>)).toBe('<a href="/about/">A</a>');
    // Where the host serves pages without a slash at the end, links don't have one either.
    expect(render({ settings: { ...settings, trailingSlash: false } }, <SiteLink href="/about/">A</SiteLink>)).toBe(
      '<a href="/about">A</a>',
    );
    expect(render({ settings }, <SiteLink href="https://example.org/news">N</SiteLink>)).toBe(
      '<a href="https://example.org/news">N</a>',
    );
    expect(
      render(
        { settings },
        <SiteLink href="https://github.com" target="_self">
          S
        </SiteLink>,
      ),
    ).toBe('<a href="https://github.com" target="_self">S</a>');
  });
});

describe("SiteImage", () => {
  it("uses the renderer's image component with the image's size, where it's known", () => {
    const media = { "/media/a.png": { width: 40, height: 20 } };
    expect(render({ base: "/repo/", components, media }, <SiteImage src="/media/a.png" alt="A" />)).toContain(
      '<img data-sized="" src="/repo/media/a.png" alt="A" width="40" height="20"/>',
    );
    expect(render({ base: "/repo/", components, media }, <SiteImage src="/media/b.png" alt="B" />)).toContain(
      '<img src="/repo/media/b.png" alt="B"/>',
    );
  });
});

describe("SiteImage with the media library's descriptions", () => {
  const descriptions = { "/media/choir.jpg": "The choir singing" };

  it("describes an image whose block leaves its description empty", () => {
    expect(render({ descriptions }, <SiteImage src="/media/choir.jpg" alt="" />)).toContain(
      '<img src="/media/choir.jpg" alt="The choir singing"/>',
    );
    expect(render({ descriptions }, <SiteImage src="/media/choir.jpg" alt="Our choir" />)).toContain('alt="Our choir"');
  });

  it("leaves images only there to look nice undescribed", () => {
    expect(render({ descriptions }, <SiteImage src="/media/choir.jpg" alt="" aria-hidden="true" />)).toContain(
      'alt=""',
    );
    expect(render({ descriptions }, <SiteImage src="/media/choir.jpg" alt="" role="presentation" />)).toContain(
      'alt=""',
    );
  });
});

describe("SiteImage with the media library's focal points", () => {
  it("keeps an image's focal point in view, unless the block places it itself", () => {
    const focus = { "/media/choir.jpg": "30% 60%" };
    expect(render({ focus }, <SiteImage src="/media/choir.jpg" alt="Choir" className="object-cover" />)).toContain(
      'style="object-position:30% 60%"',
    );
    expect(
      render({ focus }, <SiteImage src="/media/choir.jpg" alt="Choir" style={{ objectPosition: "top" }} />),
    ).toContain('style="object-position:top"');
  });
});

describe("SiteImage with smaller copies of photos", () => {
  const media = { "/media/photo.jpg": { width: 1000, height: 500 }, "/media/logo.svg": { width: 2000, height: 100 } };

  it("lists the copies the build makes in srcset, with the base path, whatever the renderer", () => {
    const html = render(
      { base: "/repo/", components, media, imageWidths: [480, 800, 1200] },
      <SiteImage src="/media/photo.jpg" alt="Hall" sizes="50vw" />,
    );
    expect(html).toContain(
      '<img width="1000" height="500" src="/repo/media/photo.jpg" alt="Hall" sizes="50vw" srcSet="/repo/media-sizes/480/photo.jpg.webp 480w, /repo/media-sizes/800/photo.jpg.webp 800w, /repo/media/photo.jpg 1000w"/>',
    );
  });

  it("leaves images the build makes no copies of to the renderer, as before", () => {
    // SVGs, other sites' images, and builds that make no copies, such as the development servers'.
    expect(render({ components, media, imageWidths: [480] }, <SiteImage src="/media/logo.svg" alt="" />)).toContain(
      '<img data-sized="" src="/media/logo.svg" alt="" width="2000" height="100"/>',
    );
    expect(render({ media, imageWidths: [480] }, <SiteImage src="https://example.org/a.jpg" alt="" />)).toContain(
      '<img src="https://example.org/a.jpg" alt=""/>',
    );
    expect(render({ components, media }, <SiteImage src="/media/photo.jpg" alt="" />)).toContain(
      '<img data-sized="" src="/media/photo.jpg" alt="" width="1000" height="500"/>',
    );
  });
});
