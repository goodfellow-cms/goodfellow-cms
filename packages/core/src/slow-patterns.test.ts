// What the code scanner found could be slow on long input: each of these reads text
// that comes from editors, other sites or WordPress, so each is tried with a long run
// of what used to make it slow, and with the ordinary cases it must still read.
import { describe, expect, it } from "vitest";
import { slugify } from "./content/changes.js";
import { choiceSlug } from "./content/collections.js";
import { renderedProblems } from "./content/rendered-checks.js";
import { themeCssLoads } from "./content/themes.js";
import { pluginFrameUrl } from "./plugins.js";
import { normalizedRepository } from "./provenance.js";
import { transferName } from "./site-transfer.js";
import { parseBlocks } from "./wordpress/blocks.js";
import { expandShortcodes } from "./wordpress/convert.js";

const LONG = 100_000;

describe("parseBlocks", () => {
  it("reads block comments, with and without attributes, closers and self-closing ones", () => {
    const blocks = parseBlocks(
      '<!-- wp:group {"layout":{"type":"flex"}} --><!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --><!-- wp:separator /--><!-- wp:acme/card {"a":1} /--><!-- /wp:group -->',
    );
    expect(blocks.map((block) => block.name)).toEqual(["core/group"]);
    expect(blocks[0]?.attrs).toEqual({ layout: { type: "flex" } });
    expect(blocks[0]?.innerBlocks.map((block) => [block.name, block.attrs])).toEqual([
      ["core/paragraph", {}],
      ["core/separator", {}],
      ["acme/card", { a: 1 }],
    ]);
  });

  it("keeps a comment that isn't a block's as HTML, and finds a block comment after it", () => {
    const blocks = parseBlocks("<!-- a note --><!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->");
    expect(blocks.map((block) => block.name)).toEqual(["core/freeform", "core/paragraph"]);
  });

  it("reads many block comments that never end quickly", () => {
    const blocks = parseBlocks("<!-- wp:a {{".repeat(LONG));
    expect(blocks.map((block) => block.name)).toEqual(["core/freeform"]);
  });
});

describe("renderedProblems", () => {
  it("leaves out what's in comments, scripts and styles", () => {
    const problems = renderedProblems({
      html: '<main class="gf-main"><!-- <img src="/a.jpg"> --><script>"<img src=/b.jpg>"</script><style>/* <img> */</style><img src="/c.jpg"></main>',
      path: "/",
      file: "content/pages/index.json",
    });
    expect(problems.map((problem) => "target" in problem && problem.target)).toEqual(["/c.jpg"]);
  });

  it("reads a page with many comments that never end quickly, taking the rest as one", () => {
    const problems = renderedProblems({
      html: `<main class="gf-main"><img src="/a.jpg">${"<!--".repeat(LONG)}<img src="/b.jpg"></main>`,
      path: "/",
      file: "content/pages/index.json",
    });
    expect(problems.map((problem) => "target" in problem && problem.target)).toEqual(["/a.jpg"]);
  });
});

describe("expandShortcodes", () => {
  const context = { note: () => {}, media: () => undefined } as unknown as Parameters<typeof expandShortcodes>[1];

  it("turns captions into figures, ending each at the first closer after it", () => {
    expect(
      expandShortcodes(
        '[caption id="1"]<img src="/a.jpg"> The choir[/CAPTION] and [caption]<img src="/b.jpg">[/caption]',
        context,
      ),
    ).toBe(
      '<figure class="wp-caption"><img src="/a.jpg"><figcaption>The choir</figcaption></figure> and <figure class="wp-caption"><img src="/b.jpg"><figcaption></figcaption></figure>',
    );
  });

  it("reads many captions that never close quickly", () => {
    expect(expandShortcodes("[caption\\]".repeat(LONG), context)).toHaveLength("[caption\\]".length * LONG);
  });
});

describe("themeCssLoads", () => {
  it("leaves out addresses in comments, but not in one that never ends", () => {
    expect(
      themeCssLoads(
        "/* url(https://a.example/x.png) */ a { background: url(https://b.example/y.png) } /* url(https://c.example/z.png)",
      ),
    ).toEqual(["https://b.example/y.png", "https://c.example/z.png"]);
  });

  it("reads CSS with many comments that never end quickly", () => {
    expect(themeCssLoads(`/*${"a/*".repeat(LONG)}`)).toEqual([]);
  });
});

describe("trimming", () => {
  it("makes the same slugs as before", () => {
    expect(slugify("--Mass & Confession Times!")).toBe("mass-confession-times");
    expect(choiceSlug("Youth ministry")).toBe("youth-ministry");
    expect(choiceSlug("日本語")).toBeUndefined();
    expect(transferName(" St. Joseph's — Parish ", new Date(2026, 10, 8))).toBe("st-joseph-s-parish-2026-11-08.zip");
    expect(transferName(`${"a".repeat(59)} b`, new Date(2026, 10, 8))).toBe(`${"a".repeat(59)}-2026-11-08.zip`);
  });

  it("finds the plugins' folder beside the editor's", () => {
    expect(pluginFrameUrl("/admin/editor/", "greeter")).toBe("/admin/plugins/greeter/index.html");
    expect(pluginFrameUrl("https://example.org/admin/editor", "greeter")).toBe(
      "https://example.org/admin/plugins/greeter/index.html",
    );
    expect(pluginFrameUrl("editor/", "greeter")).toBe("plugins/greeter/index.html");
  });

  it("spells repositories one way", () => {
    expect(normalizedRepository(" git+https://github.com/Goodfellow-CMS/Plugin.git ")).toBe(
      "https://github.com/goodfellow-cms/plugin",
    );
    expect(normalizedRepository("https://github.com/goodfellow-cms/plugin///")).toBe(
      "https://github.com/goodfellow-cms/plugin",
    );
  });

  it("trims long runs of slashes and hyphens quickly", () => {
    expect(slugify(`a${" -".repeat(LONG)}b`)).toBe("a-b");
    expect(normalizedRepository(`https://github.com/a/b${"/".repeat(LONG)}x`)).toHaveLength(
      "https://github.com/a/bx".length + LONG,
    );
  });
});
