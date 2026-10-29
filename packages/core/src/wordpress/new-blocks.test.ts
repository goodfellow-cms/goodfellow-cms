import { describe, expect, it } from "vitest";
import { type ContentSource, loadSiteContent } from "../content/load.js";
import { type ConvertContext, itemParts } from "./convert.js";
import { wordPressExport } from "./export.js";
import { readWordPressExport } from "./export-file.js";
import { planWordPressImport } from "./import.js";
import { partsMarkdown } from "./markdown.js";
import { type BlockData, IMPORT_BLOCKS, pageBlocks } from "./page-blocks.js";

const context: ConvertContext = {
  link: (address) => address.replace("https://parish.example", ""),
  media: (address) => `/media/${address.split("/").pop()}`,
  attachment: () => undefined,
  reusable: () => undefined,
  note: () => {},
};

/** Content as WordPress's block editor saves it. */
const CONTENT = `
<!-- wp:separator {"className":"is-style-wide"} -->
<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>
<!-- /wp:separator -->

<!-- wp:pullquote -->
<figure class="wp-block-pullquote"><blockquote><p>Be not afraid.</p><cite>John Paul II</cite></blockquote></figure>
<!-- /wp:pullquote -->

<!-- wp:preformatted -->
<pre class="wp-block-preformatted">Mass   9:00<br>Confession  4:00</pre>
<!-- /wp:preformatted -->

<!-- wp:verse -->
<pre class="wp-block-verse">Roses are red,
  violets are blue</pre>
<!-- /wp:verse -->

<!-- wp:details -->
<details class="wp-block-details"><summary>Parking</summary><!-- wp:paragraph -->
<p>Park behind the hall.</p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:table -->
<figure class="wp-block-table"><table><thead><tr><th>Day</th><th>Time</th></tr></thead><tbody><tr><td>Sunday</td><td>9:00</td></tr></tbody><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></table><figcaption class="wp-element-caption">Mass times</figcaption></figure>
<!-- /wp:table -->

<!-- wp:file {"id":12,"href":"https://parish.example/wp-content/uploads/2026/05/bulletin.pdf"} -->
<div class="wp-block-file"><a id="wp-block-file--media-1" href="https://parish.example/wp-content/uploads/2026/05/bulletin.pdf">This week's bulletin</a><a href="https://parish.example/wp-content/uploads/2026/05/bulletin.pdf" class="wp-block-file__button wp-element-button" download aria-describedby="wp-block-file--media-1">Download</a></div>
<!-- /wp:file -->

<!-- wp:audio {"id":13} -->
<figure class="wp-block-audio"><audio controls src="https://parish.example/wp-content/uploads/2026/05/homily.mp3"></audio><figcaption class="wp-element-caption">Sunday's homily</figcaption></figure>
<!-- /wp:audio -->

<!-- wp:media-text {"mediaPosition":"right","mediaId":14,"mediaType":"image","mediaWidth":33,"mediaUrl":"https://parish.example/wp-content/uploads/2026/05/hall.jpg","mediaAlt":"The hall"} -->
<div class="wp-block-media-text has-media-on-the-right is-stacked-on-mobile"><div class="wp-block-media-text__content"><!-- wp:paragraph -->
<p>Our hall seats 200.</p>
<!-- /wp:paragraph --></div><figure class="wp-block-media-text__media"><img src="https://parish.example/wp-content/uploads/2026/05/hall.jpg" alt="The hall"/></figure></div>
<!-- /wp:media-text -->

<!-- wp:gallery {"columns":2} -->
<figure class="wp-block-gallery has-nested-images columns-2"><!-- wp:image {"id":1} -->
<figure class="wp-block-image"><img src="https://parish.example/wp-content/uploads/2026/05/a.jpg" alt="Altar"/><figcaption class="wp-element-caption">The altar</figcaption></figure>
<!-- /wp:image -->

<!-- wp:image {"id":2} -->
<figure class="wp-block-image"><img src="https://parish.example/wp-content/uploads/2026/05/b.jpg" alt="Choir"/></figure>
<!-- /wp:image --></figure>
<!-- /wp:gallery -->

<!-- wp:page-list /-->
`;

const COVER = `
<!-- wp:cover {"url":"https://parish.example/wp-content/uploads/2026/05/church.jpg","dimRatio":70,"focalPoint":{"x":0.5,"y":0.1},"minHeight":600,"minHeightUnit":"px"} -->
<div class="wp-block-cover" style="min-height:600px"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-70 has-background-dim"></span><img class="wp-block-cover__image-background" src="https://parish.example/wp-content/uploads/2026/05/church.jpg" style="object-position:50% 10%" data-object-fit="cover" data-object-position="50% 10%"/><div class="wp-block-cover__inner-container"><!-- wp:heading -->
<h2 class="wp-block-heading">Welcome</h2>
<!-- /wp:heading --></div></div>
<!-- /wp:cover -->
`;

function blocksOf(content: string, blocks?: readonly string[]): BlockData[] {
  const sections = pageBlocks(undefined, itemParts({ content, rendered: false }, context), {
    link: context.link,
    ...(blocks && { blocks }),
  });
  return sections.flatMap((section) => section.props.content as BlockData[]);
}

function props(blocks: BlockData[], type: string): Record<string, unknown> {
  const found: Record<string, unknown> = { ...blocks.find((block) => block.type === type)?.props };
  delete found.id;
  delete found.className;
  return found;
}

describe("WordPress's own blocks", () => {
  it("come across as the built-in blocks made for them", () => {
    const blocks = blocksOf(CONTENT);
    expect(blocks.map((block) => block.type)).toEqual([
      "Separator",
      "Pullquote",
      "Preformatted",
      "Verse",
      "Details",
      "Table",
      "File",
      "Audio",
      "MediaText",
      "Gallery",
      "PageList",
    ]);
    expect(props(blocks, "Separator")).toEqual({ style: "wide" });
    expect(props(blocks, "Pullquote")).toEqual({ align: "center", citation: "John Paul II", quote: "Be not afraid." });
    expect(props(blocks, "Preformatted")).toEqual({ text: "Mass   9:00\nConfession  4:00" });
    expect(props(blocks, "Verse")).toEqual({ text: "Roses are red,\n  violets are blue" });
    const details = props(blocks, "Details");
    expect(details).toMatchObject({ open: false, summary: "Parking" });
    expect(JSON.stringify(details.content)).toContain("Park behind the hall.");
    expect(props(blocks, "Table")).toEqual({
      caption: "Mass times",
      cells: [
        ["Day", "Time"],
        ["Sunday", "9:00"],
        ["Total", "1"],
      ],
      footer: true,
      header: true,
      striped: false,
    });
    expect(props(blocks, "File")).toEqual({
      button: true,
      buttonLabel: "Download",
      file: "/wp-content/uploads/2026/05/bulletin.pdf",
      label: "This week's bulletin",
    });
    expect(props(blocks, "Audio")).toEqual({ caption: "Sunday's homily", loop: false, src: "/media/homily.mp3" });
    const mediaText = props(blocks, "MediaText");
    expect(mediaText).toMatchObject({ alt: "The hall", media: "/media/hall.jpg", position: "right", width: "third" });
    expect(JSON.stringify(mediaText.content)).toContain("Our hall seats 200.");
    expect(props(blocks, "Gallery")).toMatchObject({
      columns: "2",
      images: [
        { alt: "Altar", caption: "The altar", src: "/media/a.jpg" },
        { alt: "Choir", caption: "", src: "/media/b.jpg" },
      ],
    });
  });

  it("come across as WordPress shows them too, without their block comments", () => {
    const shown = CONTENT.replace(/<!-- \/?wp:[^>]*-->/g, "").replace(
      "",
      '<ul class="wp-block-page-list"><li class="wp-block-pages-list__item"><a href="https://parish.example/about/">About</a></li></ul>',
    );
    const blocks = pageBlocks(undefined, itemParts({ content: shown, rendered: true }, context), {
      link: context.link,
    }).flatMap((section) => section.props.content as BlockData[]);
    expect(blocks.map((block) => block.type)).toEqual([
      "PageList",
      "Separator",
      "Pullquote",
      "Preformatted",
      "Verse",
      "Details",
      "Table",
      "File",
      "Audio",
      "MediaText",
      "Gallery",
    ]);
  });

  it("make a cover's overlay, height and focal point the Section's", () => {
    const [section] = pageBlocks(undefined, itemParts({ content: COVER, rendered: false }, context), {
      link: context.link,
    });
    expect(section?.props).toMatchObject({
      backgroundImage: "/media/church.jpg",
      focus: "top",
      minHeight: "large",
      overlay: "dark",
      overlayStrength: "strong",
    });
    const [shown] = pageBlocks(
      undefined,
      itemParts({ content: COVER.replace(/<!-- \/?wp:[^>]*-->/g, ""), rendered: true }, context),
      { link: context.link },
    );
    expect(shown?.props).toMatchObject({
      focus: "top",
      minHeight: "large",
      overlay: "dark",
      overlayStrength: "strong",
    });
  });

  it("come across as before on sites without the blocks made for them", () => {
    const blocks = blocksOf(CONTENT, [...IMPORT_BLOCKS, "EntryField"]);
    const types = new Set(blocks.map((block) => block.type));
    for (const type of ["Separator", "Pullquote", "Table", "File", "Audio", "MediaText", "Gallery", "PageList"]) {
      expect(types.has(type), type).toBe(false);
    }
    const text = JSON.stringify(blocks);
    expect(text).toContain("<blockquote><p>Be not afraid.</p><p>John Paul II</p></blockquote>");
    expect(text).toContain("<p><strong>Day · Time</strong></p>");
    expect(text).toContain('"type":"Code"');
    expect(text).toContain('"type":"Grid"');
    expect(text).toContain('href=\\"/media/homily.mp3\\"');
  });

  it("write posts' versions of them as Markdown", () => {
    const markdown = partsMarkdown(itemParts({ content: CONTENT, rendered: false }, context), context.link);
    expect(markdown).toContain("---");
    expect(markdown).toContain("> Be not afraid.\n>\n> — John Paul II");
    expect(markdown).toContain("```\nMass   9:00\nConfession  4:00\n```");
    expect(markdown).toContain("Roses are red,\\\n  violets are blue");
    expect(markdown).toContain("**Parking**\n\nPark behind the hall.");
    expect(markdown).toContain("| Day | Time |");
    expect(markdown).toContain("[This week's bulletin](/wp-content/uploads/2026/05/bulletin.pdf)");
    expect(markdown).toContain("[Sunday's homily](/media/homily.mp3)");
    expect(markdown).toContain("![The hall](/media/hall.jpg)");
  });
});

describe("WordPress's own blocks exported", () => {
  const block = (type: string, props: Record<string, unknown>) => ({ type, props: { id: `${type}-1`, ...props } });
  const heading = block("Heading", { text: "Inside", level: "h2" });
  const page = {
    version: 1,
    data: {
      root: { props: { title: "Visit" } },
      content: [
        block("Section", {
          content: [
            block("Separator", { style: "dots" }),
            block("Pullquote", { quote: "Be not afraid.", citation: "John Paul II", align: "center" }),
            block("Preformatted", { text: "Mass   9:00\nConfession  4:00" }),
            block("Verse", { text: "Roses are red,\n  violets are blue" }),
            block("Details", { summary: "Parking", open: true, content: [heading] }),
            block("Table", {
              cells: [
                ["Day", "Time"],
                ["Sunday", "9:00"],
                ["Total", "1"],
              ],
              header: true,
              footer: true,
              caption: "Mass times",
              striped: true,
            }),
            block("File", { file: "/media/bulletin.pdf", label: "Bulletin", button: true, buttonLabel: "Get it" }),
            block("Audio", { src: "/media/homily.mp3", caption: "Homily", loop: false }),
            block("MediaText", {
              media: "/media/hall.jpg",
              alt: "The hall",
              position: "right",
              width: "two-thirds",
              content: [block("Heading", { text: "Our hall", level: "h2" })],
            }),
            block("Gallery", {
              images: [
                { src: "/media/a.jpg", alt: "Altar", caption: "The altar" },
                { src: "/media/b.jpg", alt: "Choir", caption: "" },
              ],
              columns: "4",
              crop: false,
              caption: "Easter",
            }),
            block("PageList", { parent: "" }),
          ],
          width: "narrow",
          padding: "lg",
          background: "none",
          backgroundImage: "",
        }),
        block("Section", {
          content: [block("Heading", { text: "Welcome", level: "h2" })],
          width: "normal",
          padding: "lg",
          background: "none",
          backgroundImage: "/media/church.jpg",
          overlay: "dark",
          overlayStrength: "strong",
          focus: "top",
          minHeight: "large",
        }),
      ],
    },
  };
  const files: Record<string, string> = {
    "content/site.json": JSON.stringify({ version: 1, title: "St. Brendan's", url: "https://stbrendan.example.org/" }),
    "content/pages/visit.json": JSON.stringify(page),
  };
  const source = (given: Record<string, string>): ContentSource => ({
    read: async (path) => given[path],
    list: async (dir) => Object.keys(given).filter((path) => path.startsWith(`${dir}/`)),
  });
  const media = ["bulletin.pdf", "homily.mp3", "hall.jpg", "a.jpg", "b.jpg", "church.jpg"].map(
    (name) => `public/media/${name}`,
  );

  it("as WordPress's core blocks", async () => {
    const { xml } = wordPressExport(await loadSiteContent(source(files)), { mediaFiles: media });
    for (const name of [
      'separator {"className":"is-style-dots"}',
      "pullquote",
      "preformatted",
      "verse",
      'details {"showContent":true}',
      'table {"className":"is-style-stripes"}',
      "file",
      "audio",
      "media-text",
      "gallery",
      "page-list",
      "cover",
    ]) {
      expect(xml, name).toContain(`<!-- wp:${name}`);
    }
    expect(xml).toContain('"dimRatio":70');
    expect(xml).toContain("<tfoot><tr><td>Total</td><td>1</td></tr></tfoot>");
  });

  it("come back as they went when imported again", async () => {
    const { xml } = wordPressExport(await loadSiteContent(source(files)), { mediaFiles: media });
    const empty = await loadSiteContent(source({ "content/site.json": JSON.stringify({ version: 1, title: "New" }) }));
    const plan = planWordPressImport(readWordPressExport(xml), empty);
    const change = plan.changes.find((candidate) => candidate.path === "content/pages/visit.json");
    const data = JSON.parse(change && "content" in change ? change.content : "{}").data;
    const [first, cover] = data.content as BlockData[];
    // The page's title comes first, as its heading.
    const [title, ...blocks] = (first?.props.content ?? []) as BlockData[];
    expect(title?.props).toMatchObject({ text: "Visit", level: "h1" });
    expect(blocks.map((each) => each.type)).toEqual([
      "Separator",
      "Pullquote",
      "Preformatted",
      "Verse",
      "Details",
      "Table",
      "File",
      "Audio",
      "MediaText",
      "Gallery",
      "PageList",
    ]);
    expect(props(blocks, "Separator")).toEqual({ style: "dots" });
    expect(props(blocks, "Pullquote")).toMatchObject({ quote: "Be not afraid.", citation: "John Paul II" });
    expect(props(blocks, "Preformatted")).toEqual({ text: "Mass   9:00\nConfession  4:00" });
    expect(props(blocks, "Verse")).toEqual({ text: "Roses are red,\n  violets are blue" });
    expect(props(blocks, "Details")).toMatchObject({ summary: "Parking", open: true });
    expect(props(blocks, "Table")).toEqual({
      caption: "Mass times",
      cells: [
        ["Day", "Time"],
        ["Sunday", "9:00"],
        ["Total", "1"],
      ],
      footer: true,
      header: true,
      striped: false,
    });
    expect(props(blocks, "File")).toMatchObject({
      file: "/media/bulletin.pdf",
      label: "Bulletin",
      buttonLabel: "Get it",
    });
    expect(props(blocks, "Audio")).toMatchObject({ src: "/media/homily.mp3", caption: "Homily" });
    expect(props(blocks, "MediaText")).toMatchObject({
      media: "/media/hall.jpg",
      position: "right",
      width: "two-thirds",
    });
    expect(props(blocks, "Gallery")).toMatchObject({
      columns: "4",
      images: [{ src: "/media/a.jpg" }, { src: "/media/b.jpg" }],
    });
    expect(cover?.props).toMatchObject({
      backgroundImage: "/media/church.jpg",
      overlay: "dark",
      overlayStrength: "strong",
      focus: "top",
      minHeight: "large",
    });
  });
});

describe("PDFs and giving pages", () => {
  const VIEWER = `
<!-- wp:file {"id":12,"href":"https://parish.example/wp-content/uploads/2026/05/bulletin.pdf","displayPreview":true,"previewHeight":700} -->
<div class="wp-block-file"><object class="wp-block-file__embed" data="https://parish.example/wp-content/uploads/2026/05/bulletin.pdf" type="application/pdf" style="width:100%;height:700px" aria-label="Embed of This week's bulletin."></object><a id="wp-block-file--media-1" href="https://parish.example/wp-content/uploads/2026/05/bulletin.pdf">This week's bulletin</a></div>
<!-- /wp:file -->
`;

  it("bring a PDF WordPress shows on the page across as a Document viewer", () => {
    expect(props(blocksOf(VIEWER), "Document")).toEqual({
      file: "/wp-content/uploads/2026/05/bulletin.pdf",
      title: "This week's bulletin",
      height: 700,
      linkLabel: "Open the document",
    });
    expect(blocksOf(VIEWER, IMPORT_BLOCKS).some((block) => block.type === "Document")).toBe(false);
  });

  it("export the Document viewer and Donate button as WordPress's File and Buttons blocks", async () => {
    const page = {
      version: 1,
      data: {
        root: { props: { title: "Give" } },
        content: [
          {
            type: "Document",
            props: { id: "Document-1", file: "/media/bulletin.pdf", title: "Bulletin", height: 600 },
          },
          {
            type: "Donate",
            props: {
              id: "Donate-1",
              heading: "Support us",
              text: "Every gift helps.",
              url: "https://donate.stripe.com/test_1",
              buttonLabel: "Give",
              align: "center",
            },
          },
          { type: "ShareButtons", props: { id: "Share-1", label: "Share", sites: [{ site: "email" }] } },
        ],
      },
    };
    const files: Record<string, string> = {
      "content/site.json": JSON.stringify({ version: 1, title: "St. Joseph", url: "https://parish.example" }),
      "content/pages/give.json": JSON.stringify(page),
    };
    const source: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    const { xml, notes } = wordPressExport(await loadSiteContent(source));
    expect(xml).toContain('"displayPreview":true,"previewHeight":600');
    expect(xml).toContain('<object class="wp-block-file__embed"');
    expect(xml).toContain('href="https://donate.stripe.com/test_1" target="_blank" rel="noreferrer noopener">Give</a>');
    expect(xml).toContain("Every gift helps.");
    expect(JSON.stringify(notes)).toContain("ShareButtons");
  });
});
