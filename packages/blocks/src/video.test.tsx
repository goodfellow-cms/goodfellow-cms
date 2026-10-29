import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";
import type { VideoProps } from "./video.js";

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

async function render(props: Partial<VideoProps>, site = content): Promise<string> {
  const page: Page = {
    path: "/",
    file: "content/pages/index.json",
    content: {
      version: 1,
      data: {
        root: { props: {} },
        content: [{ type: "Video", props: { id: "v", ...blocks.Video.defaultProps, ...props } }],
      },
    },
  };
  const html = await renderPage(site, page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

describe("Video", () => {
  it("loads another site's player only once visitors agree, on a site that asks", async () => {
    const asks = { ...content, settings: siteSettingsSchema.parse({ ...content.settings, consent: {} }) };
    const html = await render({ source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ" }, asks);
    expect(html).toContain('data-gf-consent-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(html).not.toMatch(/<iframe[^>]* src=/);
    expect(html).toContain('<button type="button" data-gf-consent-accept="content">Allow and show it</button>');
    // An uploaded video is the site's own, so it plays as ever.
    expect(await render({ source: "upload", file: "/media/welcome.mp4" }, asks)).toContain('src="/media/welcome.mp4"');
  });

  it("plays an uploaded video, with its picture and captions", async () => {
    const html = await render({
      source: "upload",
      file: "/media/welcome.mp4",
      poster: "/media/welcome.jpg",
      captions: "/media/welcome.vtt",
      captionsLabel: "English",
      title: "Welcome from Fr. Thomas",
      caption: "A welcome from our pastor",
    });
    expect(html).toMatch(/<video [^>]*src="\/media\/welcome.mp4"/);
    expect(html).toContain('poster="/media/welcome.jpg"');
    expect(html).toContain('aria-label="Welcome from Fr. Thomas"');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain("controls");
    expect(html).toContain('<track kind="captions" src="/media/welcome.vtt" srcLang="en" label="English" default=""/>');
    expect(html).toContain("<figcaption");
  });

  it("plays on its own without sound, as browsers require", async () => {
    const html = await render({ source: "upload", file: "/media/loop.webm", autoplay: true, loop: true });
    const video = /<video [^>]*>/.exec(html)?.[0] ?? "";
    expect(video).toContain("autoPlay");
    expect(video).toContain("muted");
    expect(video).toContain("loop");
  });

  it("shows YouTube's privacy-enhanced player from any of a video's addresses", async () => {
    const html = await render({ source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ?t=42", title: "Our choir" });
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&amp;start=42"');
    expect(html).toContain('title="Our choir"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain("aspect-video");
    // YouTube's player is allowlisted, so it isn't sandboxed.
    expect(html).not.toContain("sandbox");
  });

  it("shows Vimeo's player, with do not track", async () => {
    const html = await render({ source: "vimeo", vimeo: "https://vimeo.com/76979871", shape: "square" });
    expect(html).toContain('src="https://player.vimeo.com/video/76979871?dnt=1"');
    expect(html).toContain("aspect-square");
  });

  it("shows another site's player in a sandbox, only from another secure site", async () => {
    const html = await render({
      source: "embed",
      embed: '<iframe src="https://fast.wistia.net/embed/iframe/abc123?videoFoam=true" width="640"></iframe>',
    });
    expect(html).toContain('src="https://fast.wistia.net/embed/iframe/abc123?videoFoam=true"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups');
    for (const embed of ["http://player.example.org/1", "https://parish.example.org/admin", "javascript:alert(1)"]) {
      expect(await render({ source: "embed", embed }), embed).not.toContain("<iframe");
    }
  });

  it("shows nothing on the site for a video that can't be shown", async () => {
    expect(await render({ source: "youtube", youtube: "not a video" })).not.toContain("<iframe");
    expect(await render({ source: "upload", file: "" })).not.toContain("<video");
  });
});
