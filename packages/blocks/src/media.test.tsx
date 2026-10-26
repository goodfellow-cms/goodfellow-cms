import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const content: SiteContent = {
  settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph" }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [],
  customCss: "",
};

async function render(blocksData: unknown[]) {
  const page = { path: "/", file: "", content: { version: 1, data: { root: { props: {} }, content: blocksData } } };
  const html = await renderPage(content, page as Page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

describe("WordPress's media blocks", () => {
  it("links to a file by its name, with a download button", async () => {
    const html = await render([
      {
        type: "File",
        props: {
          id: "f",
          file: "/media/bulletin.pdf",
          label: "",
          button: true,
          buttonLabel: "Download",
          className: "",
        },
      },
    ]);
    expect(html).toMatch(/<a href="\/media\/bulletin\.pdf" class="gf-file-link[^"]*">bulletin\.pdf<\/a>/);
    expect(html).toMatch(/<a href="\/media\/bulletin\.pdf" download="" class="gf-file-button[^"]*">Download<\/a>/);
  });

  it("shows visitors nothing for media blocks with nothing chosen", async () => {
    const html = await render([
      { type: "File", props: { id: "f", file: "", label: "", button: true, buttonLabel: "", className: "" } },
      { type: "Audio", props: { id: "a", src: "", caption: "", loop: false, className: "" } },
      {
        type: "Gallery",
        props: { id: "g", images: [], columns: "3", crop: true, rounded: true, caption: "", className: "" },
      },
    ]);
    expect(html).not.toContain("gf-file");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("gf-gallery");
    expect(html).not.toContain("Choose");
  });

  it("plays a sound file with the browser's player", async () => {
    const html = await render([
      {
        type: "Audio",
        props: { id: "a", src: "/media/sermon.mp3", caption: "Sunday's homily", loop: true, className: "" },
      },
    ]);
    expect(html).toContain(
      '<audio controls="" preload="metadata" loop="" src="/media/sermon.mp3" class="gf-audio-player w-full"></audio>',
    );
    expect(html).toContain("Sunday&#x27;s homily</figcaption>");
  });

  it("puts a picture beside blocks, on either side and at any width", async () => {
    const text = [{ type: "Heading", props: { id: "h", text: "Welcome", level: "h2", align: "left", className: "" } }];
    const left = await render([
      {
        type: "MediaText",
        props: {
          id: "m",
          media: "/media/church.jpg",
          alt: "The church",
          position: "left",
          width: "third",
          align: "top",
          rounded: true,
          content: text,
          className: "",
        },
      },
    ]);
    expect(left).toContain('class="gf-media-text grid grid-cols-1 gap-6 md:gap-10 md:grid-cols-[1fr_2fr] items-start"');
    expect(left).toMatch(
      /<img src="\/media\/church\.jpg" alt="The church" loading="lazy" class="gf-media-text-media w-full object-cover rounded-lg"\/><div class="gf-media-text-content[^"]*">.*Welcome/s,
    );
    const right = await render([
      {
        type: "MediaText",
        props: {
          id: "m",
          media: "/media/welcome.mp4",
          alt: "",
          position: "right",
          width: "third",
          align: "center",
          rounded: false,
          content: text,
          className: "",
        },
      },
    ]);
    expect(right).toContain("md:grid-cols-[2fr_1fr]");
    expect(right).toMatch(
      /<video controls="" preload="metadata" src="\/media\/welcome\.mp4" class="gf-media-text-media w-full object-cover rounded-none md:order-last">/,
    );
  });

  it("shows a gallery's pictures in a grid, with their captions and the gallery's", async () => {
    const html = await render([
      {
        type: "Gallery",
        props: {
          id: "g",
          images: [
            { src: "/media/a.jpg", alt: "Altar", caption: "The altar" },
            { src: "", alt: "", caption: "Not chosen yet" },
            { src: "/media/b.jpg", alt: "Choir", caption: "" },
          ],
          columns: "4",
          crop: true,
          rounded: false,
          caption: "Easter",
          className: "",
        },
      },
    ]);
    expect(html).toContain('<ul class="gf-gallery-items grid gap-4 grid-cols-2 md:grid-cols-4">');
    expect(html.match(/<li class="gf-gallery-item">/g)).toHaveLength(2);
    expect(html).not.toContain("Not chosen yet");
    expect(html).toContain(
      '<img src="/media/a.jpg" alt="Altar" loading="lazy" class="gf-gallery-picture w-full aspect-square object-cover rounded-none"/><figcaption class="gf-gallery-item-caption mt-1 text-sm text-muted-foreground">The altar</figcaption>',
    );
    expect(html).toMatch(/<figcaption class="gf-gallery-caption[^"]*">Easter<\/figcaption><\/figure>/);
  });
});
