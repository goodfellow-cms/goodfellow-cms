import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbedProps } from "./embed.js";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const content: SiteContent = {
  settings: siteSettingsSchema.parse({
    version: 1,
    title: "St. Joseph",
    url: "https://parish.example.org",
    language: "en",
  }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [],
  customCss: "",
};

async function render(props: Partial<EmbedProps>, site = content): Promise<string> {
  const page: Page = {
    path: "/",
    file: "content/pages/index.json",
    content: {
      version: 1,
      data: {
        root: { props: {} },
        content: [{ type: "Embed", props: { id: "e", ...blocks.Embed.defaultProps, ...props } }],
      },
    },
  };
  const html = await renderPage(site, page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

const DID = "did:plc:z72i7hdynmk6r22z27h6tvur";

afterEach(() => vi.unstubAllGlobals());

describe("Embed", () => {
  it("shows a post in a sandboxed frame as tall as its site's embed usually is", async () => {
    const html = await render({ post: "https://mastodon.social/@Gargron/111111111111111111", caption: "Our news" });
    expect(html).toContain('src="https://mastodon.social/@Gargron/111111111111111111/embed"');
    expect(html).toContain('title="Post on Mastodon"');
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"',
    );
    expect(html).toContain('style="height:400px"');
    expect(html).toContain("max-w-xl");
    expect(html).toContain("<figcaption");
  });

  it("takes the height and title an editor gives, and lets players fill the width", async () => {
    const html = await render({
      post: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      height: 500,
      title: "Our choir's playlist",
    });
    expect(html).toContain('src="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"');
    expect(html).toContain('style="height:500px"');
    expect(html).toContain('title="Our choir&#x27;s playlist"');
    expect(html).not.toContain("max-w-xl");
  });

  it("loads the post only once visitors agree, on a site that asks", async () => {
    const asks = { ...content, settings: siteSettingsSchema.parse({ ...content.settings, consent: {} }) };
    const html = await render({ post: "https://x.com/jack/status/20" }, asks);
    expect(html).toContain('data-gf-consent-src="https://platform.twitter.com/embed/Tweet.html?id=20&amp;dnt=true"');
    expect(html).not.toMatch(/<iframe[^>]* src=/);
  });

  it("looks up a Bluesky author's DID where pages are built", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => Response.json({ did: DID }));
    vi.stubGlobal("fetch", fetcher);
    const html = await render({ post: "https://bsky.app/profile/news.example.org/post/3l6oveex3ii2l" });
    expect(html).toContain(`src="https://embed.bsky.app/embed/${DID}/app.bsky.feed.post/3l6oveex3ii2l"`);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=news.example.org",
    );
  });

  it("links a Bluesky post it couldn't look up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = await render({ post: "https://bsky.app/profile/gone.example.org/post/3kabc" });
    expect(html).toContain('href="https://bsky.app/profile/gone.example.org/post/3kabc"');
    expect(html).not.toContain("<iframe");
  });

  it("shows visitors nothing for what it can't show", async () => {
    expect(await render({ post: "https://example.org/somewhere" })).not.toContain("gf-embed");
    expect(await render({ post: "https://parish.example.org/@someone/123" })).not.toContain("<iframe");
  });
});
