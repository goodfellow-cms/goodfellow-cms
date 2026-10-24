import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";
import { buildNotes, fontFilesFor, fontPreloads, selfHostedFonts, withSelfHostedFonts } from "./fonts.js";
import { rootRobotsUrl } from "./head.js";

const face = (subset: string, family: string, weight: string, file: string, style = "normal") => `/* ${subset} */
@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/${file}.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

// As Google answers: one face for each subset and weight, which a variable font's weights share a file for.
const css = [
  face("latin-ext", "Fraunces", "400", "fraunces/ext"),
  face("latin", "Fraunces", "400", "fraunces/latin"),
  face("latin", "Fraunces", "700", "fraunces/latin"),
  face("latin", "Lora", "400", "lora/400"),
  face("latin", "Lora", "400", "lora/400-italic", "italic"),
  face("latin", "Lora", "700", "lora/700"),
  face("latin", "Inter", "100 900", "inter/variable"),
].join("\n");

const theme = (fonts: object) => siteSettingsSchema.parse({ version: 1, theme: { fonts } }).theme;

describe("fontFilesFor", () => {
  it("picks each family's latin file at the weight pages show most, once", () => {
    expect(
      fontFilesFor(css, [
        { family: "Lora", weight: 400 },
        { family: "Fraunces", weight: 700 },
      ]),
    ).toEqual(["https://fonts.gstatic.com/s/fraunces/latin.woff2", "https://fonts.gstatic.com/s/lora/400.woff2"]);
    expect(fontFilesFor(css, [{ family: "Inter", weight: 700 }])).toEqual([
      "https://fonts.gstatic.com/s/inter/variable.woff2",
    ]);
  });

  it("leaves out files anywhere but Google's", () => {
    const elsewhere = css.replaceAll("https://fonts.gstatic.com/", "https://example.org/");
    expect(fontFilesFor(elsewhere, [{ family: "Lora", weight: 400 }])).toEqual([]);
  });
});

describe("fontPreloads", () => {
  it("reads the site's stylesheet once, as a browser that takes woff2 files", async () => {
    const asked: Array<{ url: string; agent: string }> = [];
    const read = async (url: string, agent: string) => {
      asked.push({ url, agent });
      return css;
    };
    const site = theme({ heading: "Fraunces", body: "Lora" });
    const files = await fontPreloads(site, read);
    expect(files).toEqual([
      "https://fonts.gstatic.com/s/fraunces/latin.woff2",
      "https://fonts.gstatic.com/s/lora/400.woff2",
    ]);
    // Every page of a build asks; the stylesheet is read for the first.
    expect(await fontPreloads(site, read)).toEqual(files);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(
      "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600;700&family=Lora:wght@400;500;600;700&display=swap",
    );
    expect(asked[0]?.agent).toContain("Chrome/");
  });

  it("builds pages without preloading when the stylesheet can't be read, or there are no fonts", async () => {
    const failing = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await fontPreloads(theme({ body: "Lora" }), failing)).toEqual([]);
    expect(await fontPreloads(theme({ body: "Lora" }), async () => undefined)).toEqual([]);
    expect(await fontPreloads(theme({}), failing)).toEqual([]);
  });
});

describe("selfHostedFonts", () => {
  const read = async () => css;
  const readFont = async (url: string) => new TextEncoder().encode(`font ${url}`);

  it("copies every file the stylesheet names, and points the stylesheet at the copies", async () => {
    const fonts = await selfHostedFonts(theme({ heading: "Fraunces", body: "Lora" }), read, readFont);
    expect(fonts?.stylesheet).toMatch(/^fonts\/google\/[0-9a-f]{8}\.css$/);
    expect(fonts?.fonts.map((font) => font.path)).toEqual([
      "fonts/google/s/fraunces/ext.woff2",
      "fonts/google/s/fraunces/latin.woff2",
      "fonts/google/s/lora/400.woff2",
      "fonts/google/s/lora/400-italic.woff2",
      "fonts/google/s/lora/700.woff2",
      "fonts/google/s/inter/variable.woff2",
    ]);
    const stylesheet = fonts?.files[0];
    expect(stylesheet && "content" in stylesheet && stylesheet.content).toContain("src: url(s/lora/700.woff2)");
    expect(stylesheet && "content" in stylesheet && stylesheet.content).not.toContain("gstatic");
    expect(fonts?.files).toHaveLength(7);
  });

  it("leaves the fonts to Google when anything can't be read, or names a file it wouldn't copy", async () => {
    const site = theme({ body: "Lora" });
    expect(await selfHostedFonts(theme({}), read, readFont)).toBeUndefined();
    expect(await selfHostedFonts(site, async () => undefined, readFont)).toBeUndefined();
    expect(
      await selfHostedFonts(site, read, async (url) => (url.includes("700") ? undefined : new Uint8Array(1))),
    ).toBeUndefined();
    const outside = css.replace("s/lora/700", "s/../../secret");
    expect(await selfHostedFonts(site, async () => outside, readFont)).toBeUndefined();
  });
});

describe("withSelfHostedFonts", () => {
  it("points a page's stylesheet and preloads at the site's copies, under its base path", async () => {
    const site = theme({ heading: "Fraunces", body: "Lora" });
    const fonts = await selfHostedFonts(
      site,
      async () => css,
      async () => new Uint8Array(1),
    );
    if (!fonts) throw new Error("no fonts");
    const google = fonts.source.replaceAll("&", "&amp;");
    const page = `<head><link rel="preload" href="https://fonts.gstatic.com/s/lora/400.woff2" as="font" type="font/woff2" crossorigin=""/><link rel="stylesheet" href="${google}"/></head>`;
    expect(withSelfHostedFonts(page, fonts, "/my-site")).toBe(
      `<head><link rel="preload" href="/my-site/fonts/google/s/lora/400.woff2" as="font" type="font/woff2" crossorigin=""/><link rel="stylesheet" href="/my-site/${fonts.stylesheet}"/></head>`,
    );
    // Next.js's payload spells the address as JSON.
    expect(withSelfHostedFonts(`["$","link",{"href":"${fonts.source.replaceAll("&", "\\u0026")}"}]`, fonts)).toBe(
      `["$","link",{"href":"/${fonts.stylesheet}"}]`,
    );
    // Files the site didn't copy, such as in its own code, are left alone.
    expect(withSelfHostedFonts("https://fonts.gstatic.com/s/other/1.woff2", fonts)).toBe(
      "https://fonts.gstatic.com/s/other/1.woff2",
    );
  });
});

describe("buildNotes", () => {
  it("says where search engines read robots.txt for a site in a subfolder, and when the fonts stayed with Google", () => {
    expect(rootRobotsUrl("https://name.github.io/site/")).toBe("https://name.github.io/robots.txt");
    expect(rootRobotsUrl("https://example.org/")).toBeUndefined();
    expect(rootRobotsUrl("https://example.org")).toBeUndefined();
    expect(rootRobotsUrl(undefined)).toBeUndefined();
    const notes = buildNotes({
      fonts: { unavailable: true },
      robotsElsewhere: "https://name.github.io/robots.txt",
      sitemap: "https://name.github.io/site/sitemap.xml",
    });
    expect(notes[0]).toContain("load their fonts from Google");
    expect(notes[1]).toContain("Unless that one names https://name.github.io/site/sitemap.xml, name it there");
    expect(buildNotes({ fonts: { hosted: 1 } })).toEqual([
      "Copied 1 font file into the site, so visitors' browsers don't ask Google Fonts for them",
    ]);
  });
});
