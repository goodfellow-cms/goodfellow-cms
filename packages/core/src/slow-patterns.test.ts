// What the code scanner found could be slow on long input: each of these reads text
// that comes from editors, other sites, or WordPress, so each is tried with a long run
// of what used to make it slow, and with the ordinary cases it must still read.
import { describe, expect, it } from "vitest";
import { siteGuard, startsWithGuard, withGuard } from "./admin-domain.js";
import { addressPatternFor, movedPageRedirects, slugify } from "./content/changes.js";
import { choiceSlug } from "./content/collections.js";
import { storedMediaUrl } from "./content/media-storage.js";
import { renderedProblems } from "./content/rendered-checks.js";
import { THEME_CSS_END, themeCssLoads, themeCssRegion, withThemeCss } from "./content/themes.js";
import { fontFileName } from "./custom-fonts.js";
import { fontFilesFor } from "./fonts.js";
import { markdownExportName } from "./markdown-export.js";
import { pluginFrameUrl } from "./plugins.js";
import { normalizedRepository } from "./provenance.js";
import { siteCopyFrom } from "./site-copy.js";
import { transferName } from "./site-transfer.js";
import { parseBlocks } from "./wordpress/blocks.js";
import { expandShortcodes } from "./wordpress/convert.js";

const LONG = 100_000;

describe("parseBlocks", () => {
  it("reads block comments, with and without attributes, closers, and self-closing ones", () => {
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

  it("reads block comments after long runs of spaces quickly", () => {
    const blocks = parseBlocks(`${"<!--\t".repeat(LONG)}<!--${"\t".repeat(LONG)}wp:separator /-->`);
    expect(blocks.map((block) => block.name)).toEqual(["core/freeform", "core/separator"]);
  });

  it("reads many block comments that never end quickly", () => {
    const blocks = parseBlocks("<!-- wp:a {{".repeat(LONG));
    expect(blocks.map((block) => block.name)).toEqual(["core/freeform"]);
  });
});

describe("renderedProblems", () => {
  it("leaves out what's in comments, scripts, and styles", () => {
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

  it("reads many shortcodes whose brackets never close quickly", () => {
    for (const name of ["gallery", "video", "caption", "acme"]) {
      expect(expandShortcodes(`[${name}\\`.repeat(LONG), context)).toHaveLength(`[${name}\\`.length * LONG);
    }
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

describe("theme CSS", () => {
  const theme = { name: "goodfellow-theme-harbor", release: "1.2.0", css: "a { color: red }" };

  it("finds, replaces, and removes the theme's region as before", () => {
    const css = withThemeCss("p { margin: 0 }\n", theme);
    expect(themeCssRegion(css)).toEqual({ name: "goodfellow-theme-harbor", css: "a { color: red }" });
    expect(themeCssRegion(withThemeCss(css, { ...theme, css: "b { color: blue }" }))?.css).toBe("b { color: blue }");
    expect(withThemeCss(css, undefined)).toBe("p { margin: 0 }\n");
  });

  it("reads custom CSS with many lines that start like the theme's quickly", () => {
    const start = withThemeCss("", theme).split("\n")[0] ?? "";
    expect(themeCssRegion(`${start}\n`.repeat(LONG))).toBeUndefined();
    expect(themeCssRegion(`${start.slice(0, -2)}\n`.repeat(LONG) + THEME_CSS_END)).toBeUndefined();
  });

  it("reads quoted and plain addresses, brackets in quotes included", () => {
    expect(
      themeCssLoads(
        `a { background: url( "https://a.example/x(1).png" ), URL('https://b.example/y.png'), url( https://c.example/z.png ) }`,
      ),
    ).toEqual(["https://a.example/x(1).png", "https://b.example/y.png", "https://c.example/z.png"]);
  });

  it("reads many addresses that never close quickly", () => {
    // Unclosed quotes run to the next ")", as browsers' CSS would read them.
    expect(themeCssLoads(`${"url('".repeat(LONG)}url(https://a.example/x.png)`)).toHaveLength(1);
    expect(themeCssLoads(`${'url("" '.repeat(LONG)})`)).toHaveLength(1);
    expect(themeCssLoads(`a { background: ${"url(".repeat(LONG)}`)).toBeDefined();
    expect(themeCssLoads(`a { background: url(${" ".repeat(LONG)}x`)).toBeDefined();
  });
});

describe("fontFilesFor", () => {
  const face = (url: string) =>
    `/* latin */\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: 400;\n  src: url(${url}) format('woff2');\n}\n`;

  it("finds the latin files", () => {
    expect(fontFilesFor(face("https://fonts.gstatic.com/s/inter/a.woff2"), [{ family: "Inter", weight: 400 }])).toEqual(
      ["https://fonts.gstatic.com/s/inter/a.woff2"],
    );
  });

  it("reads stylesheets with many faces and addresses that never end quickly", () => {
    expect(fontFilesFor("/* latin */ @font-face {".repeat(LONG), [{ family: "Inter", weight: 400 }])).toEqual([]);
    expect(fontFilesFor(face(`https://fonts.gstatic.com/${"url(".repeat(LONG)}`), [])).toEqual([]);
  });
});

describe("page guards", () => {
  const script = siteGuard("https://admin.example.org", "https://example.org");

  it("puts the guard after the head, and inside an SVG's root after its prolog", () => {
    const page = withGuard("<!doctype html><html><head><title>A</title></head></html>", "html", script) ?? "";
    expect(startsWithGuard(page, "html")).toBe(true);
    const svg =
      withGuard(
        '\uFEFF<?xml version="1.0"?><!-- a --><!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>',
        "svg",
        script,
      ) ?? "";
    expect(startsWithGuard(svg, "svg")).toBe(true);
  });

  it("keeps the guard's script from closing its element", () => {
    expect(siteGuard("https://admin.example.org/</script>", undefined)).not.toContain("</script>");
  });

  it("reads pages with many tags and prologs that never end quickly", () => {
    // Pages whose tags never end get the guard first of all.
    expect(withGuard("<head".repeat(LONG), "html", script)?.startsWith("<script")).toBe(true);
    expect(withGuard(`<html${" ".repeat(LONG)}`, "html", script)?.startsWith("<script")).toBe(true);
    expect(withGuard(`<!doctype [${"<!--".repeat(LONG)}`, "svg", script)).toBeUndefined();
    expect(withGuard(`${"<!-- -->".repeat(LONG)}<?a`, "svg", script)).toBeUndefined();
  });
});

describe("more trimming", () => {
  it("trims as before", () => {
    expect(siteCopyFrom({ GOODFELLOW_SITE_URL: "https://staging.example.org///" }).url).toBe(
      "https://staging.example.org",
    );
    expect(
      storedMediaUrl({ url: "https://cdn.example.org//", files: { "/media/a.jpg": {} } } as never, "/media/a.jpg"),
    ).toBe("https://cdn.example.org/a.jpg");
    expect(addressPatternFor(" /videos// ")).toBe("/videos/{slug}");
    expect(fontFileName("--Brandon Grotesque--", { weight: 700, style: "italic" })).toBe(
      "brandon-grotesque-700-italic.woff2",
    );
    expect(markdownExportName({ settings: { title: "  St. Joseph's — Parish!  " } } as never)).toMatch(
      /^st-joseph-s-parish/,
    );
    expect(movedPageRedirects([{ from: "/a", to: "/old/?x#y" }], "/old", "/new")).toEqual([
      { from: "/a", to: "/new?x#y" },
      { from: "/old", to: "/new" },
    ]);
  });

  it("trims long runs quickly", () => {
    expect(siteCopyFrom({ GOODFELLOW_SITE_URL: `https://a.example${"/".repeat(LONG)}x` }).url).toHaveLength(
      "https://a.example".length + LONG + 1,
    );
    expect(addressPatternFor(`/a${"/".repeat(LONG)}x`)).toHaveLength(`/a/x/{slug}`.length + LONG - 1);
    expect(fontFileName(`a${"-".repeat(LONG)}`, { weight: 400 } as never)).toBe("a-400.woff2");
    expect(markdownExportName({ settings: { title: `a${" -".repeat(LONG)}` } } as never)).toMatch(/^a/);
    expect(movedPageRedirects([{ from: "/a", to: `/b${"?".repeat(LONG)}` }], "/old", "/new")).toHaveLength(2);
  });
});
