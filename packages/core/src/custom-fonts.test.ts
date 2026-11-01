import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSite } from "./content/checks.js";
import { type ContentSource, loadSiteContent } from "./content/load.js";
import { siteSettingsSchema } from "./content/schemas.js";
import { themeManifestSchema } from "./content/themes.js";
import {
  customFont,
  customFontFaces,
  customFontFileChanges,
  customFontPaths,
  customFontPreloads,
  fontFileFor,
  fontFileName,
  guessFontFamily,
  guessFontFile,
  isSafeFontFile,
  isWoff2,
} from "./custom-fonts.js";
import { fontStandIns } from "./node-fonts.js";
import { googleFontsUrl, themeToCss } from "./theme.js";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "../test/fonts/inter-sample.woff2");

const brandon = {
  family: "Brandon",
  category: "serif",
  files: [
    { src: "/media/fonts/brandon-400.woff2", weight: 400 },
    { src: "/media/fonts/brandon-700.woff2", weight: 700 },
    { src: "/media/fonts/brandon-400-italic.woff2", weight: 400, style: "italic" },
  ],
};
const settings = (fonts: object) => siteSettingsSchema.parse({ version: 1, theme: { fonts } });
const theme = (fonts: object) => settings(fonts).theme;

describe("the setting", () => {
  it("takes fonts in the media library's fonts folder, and refuses others", () => {
    const parse = (custom: unknown) =>
      siteSettingsSchema.safeParse({ version: 1, theme: { fonts: { custom } } }).success;
    expect(parse([brandon])).toBe(true);
    expect(parse([{ family: "Vary", files: [{ src: "/media/fonts/vary.woff2", weight: 100, weightTo: 900 }] }])).toBe(
      true,
    );
    expect(parse([{ family: "Elsewhere", files: [{ src: "https://example.org/a.woff2", weight: 400 }] }])).toBe(false);
    expect(parse([{ family: "Up", files: [{ src: "/media/fonts/../x.woff2", weight: 400 }] }])).toBe(false);
    expect(parse([{ family: "Not", files: [{ src: "/media/fonts/x.ttf", weight: 400 }] }])).toBe(false);
    expect(parse([{ family: 'Bad"; }', files: [{ src: "/media/fonts/x.woff2", weight: 400 }] }])).toBe(false);
    expect(parse([{ family: "Backwards", files: [{ src: "/media/fonts/x.woff2", weight: 700, weightTo: 300 }] }])).toBe(
      false,
    );
    expect(parse([brandon, { ...brandon, family: "brandon" }])).toBe(false);
  });

  it("isn't something a theme can bring, since it can't bring the files", () => {
    const manifest = { version: 1, title: "Mine", theme: { fonts: { custom: [brandon] } } };
    expect(themeManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("pages", () => {
  const site = theme({ heading: "Brandon", body: "Inter", custom: [brandon] });

  it("write each file's @font-face under the base path, and keep the family out of Google's stylesheet", () => {
    expect(customFontFaces(site, "/parish/")).toBe(
      '@font-face{font-family:"Brandon";src:url("/parish/media/fonts/brandon-400.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}' +
        '@font-face{font-family:"Brandon";src:url("/parish/media/fonts/brandon-700.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}' +
        '@font-face{font-family:"Brandon";src:url("/parish/media/fonts/brandon-400-italic.woff2") format("woff2");font-weight:400;font-style:italic;font-display:swap}',
    );
    expect(googleFontsUrl(site)).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    );
    expect(googleFontsUrl(theme({ heading: "Brandon", custom: [brandon] }))).toBeUndefined();
    const css = themeToCss(site);
    expect(css).toContain('src:url("/media/fonts/brandon-700.woff2")');
    // The family falls back to fonts of its own kind.
    expect(css).toContain('--gf-font-heading:"Brandon", ui-serif');
    // The admin panel's frames add them from their bytes instead.
    expect(themeToCss(site, undefined, { fontFaces: false })).not.toContain("@font-face");
  });

  it("write variable fonts' weights as a range", () => {
    const vary = theme({
      custom: [{ family: "Vary", files: [{ src: "/media/fonts/vary.woff2", weight: 100, weightTo: 900 }] }],
    });
    expect(customFontFaces(vary)).toContain("font-weight:100 900;");
  });

  it("preload the text font's 400 and the headings' 700, upright", () => {
    expect(customFontPreloads(site)).toEqual(["/media/fonts/brandon-700.woff2"]);
    expect(customFontPreloads(theme({ heading: "Brandon", body: "Brandon", custom: [brandon] }))).toEqual([
      "/media/fonts/brandon-400.woff2",
      "/media/fonts/brandon-700.woff2",
    ]);
    const own = customFont(site, "brandon");
    expect(own && fontFileFor(own, 600)?.src).toBe("/media/fonts/brandon-700.woff2");
    expect(customFontPaths(site)).toContain("public/media/fonts/brandon-400-italic.woff2");
  });

  it("measure the site's own fonts from their files for their stand-ins", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodfellow-fonts-"));
    await mkdir(join(root, "public/media/fonts"), { recursive: true });
    await copyFile(SAMPLE, join(root, "public/media/fonts/sample-400.woff2"));
    const sample = theme({
      body: "Sample",
      custom: [
        { family: "Sample", category: "sans-serif", files: [{ src: "/media/fonts/sample-400.woff2", weight: 400 }] },
      ],
    });
    // Without the site on disk, there's nothing to measure.
    expect(await fontStandIns(sample)).toEqual({ css: "" });
    const standIns = await fontStandIns(sample, { root });
    expect(standIns.body?.[0]).toBe("Sample fallback (Arial)");
    expect(standIns.css).toContain('font-family: "Sample fallback (Arial)"');
    expect(themeToCss(sample, standIns)).toContain('--gf-font-body:"Sample", "Sample fallback (Arial)"');
    await rm(root, { recursive: true, force: true });
  });
});

describe("files", () => {
  it("tell WOFF2 fonts by their bytes, in the fonts folder only", async () => {
    const bytes = new Uint8Array(await readFile(SAMPLE));
    expect(isWoff2(bytes)).toBe(true);
    expect(isWoff2(new TextEncoder().encode("<script>alert(1)</script>".padEnd(64)))).toBe(false);
    expect(isSafeFontFile("public/media/fonts/sample-400.woff2", bytes)).toBe(true);
    expect(isSafeFontFile("public/media/sample.woff2", bytes)).toBe(false);
    expect(isSafeFontFile("public/media/fonts/Sample.woff2", bytes)).toBe(false);
    expect(isSafeFontFile("public/media/fonts/sample.woff2", new TextEncoder().encode("x".repeat(100)))).toBe(false);
    expect(isSafeFontFile("public/media/fonts/sample.woff2", undefined)).toBe(false);
  });

  it("guess a file's weight, style and family from its name", () => {
    expect(guessFontFile("Brandon-SemiBoldItalic.woff2")).toEqual({ weight: 600, style: "italic" });
    expect(guessFontFile("brandon_grotesque_bold.woff2")).toEqual({ weight: 700 });
    expect(guessFontFile("Brandon-ExtraLight.woff2")).toEqual({ weight: 200 });
    expect(guessFontFile("Brandon-Black.woff2")).toEqual({ weight: 900 });
    expect(guessFontFile("Brandon-300.woff2")).toEqual({ weight: 300 });
    expect(guessFontFile("Brandon.woff2")).toEqual({ weight: 400 });
    expect(guessFontFile("Brandon-Variable.woff2")).toEqual({ weight: 100, weightTo: 900 });
    expect(guessFontFile("Brandon[wght]-Italic.woff2")).toEqual({ weight: 100, weightTo: 900, style: "italic" });
    expect(guessFontFamily("Brandon_Grotesque-BoldItalic.woff2")).toBe("Brandon Grotesque");
    expect(guessFontFamily("BrandonText-Regular.woff2")).toBe("Brandon Text");
    expect(fontFileName("Brandon Grotesque", { weight: 700, style: "italic" })).toBe(
      "brandon-grotesque-700-italic.woff2",
    );
    expect(fontFileName("Vary", { weight: 100, weightTo: 900 })).toBe("vary-100-900.woff2");
  });
});

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

describe("elsewhere", () => {
  it("reports a missing font file as missing media", async () => {
    const content = await loadSiteContent(
      memorySource({
        "content/site.json": {
          version: 1,
          title: "Parish",
          theme: { fonts: { heading: "Brandon", custom: [brandon] } },
        },
      }),
    );
    const problems = checkSite(content, {
      media: ["/media/fonts/brandon-400.woff2", "/media/fonts/brandon-700.woff2"],
      blocks: {},
      today: "2026-10-31",
    });
    expect(problems.filter((problem) => problem.kind === "missing-media").map((problem) => problem.target)).toEqual([
      "/media/fonts/brandon-400-italic.woff2",
    ]);
  });
});

describe("customFontFileChanges", () => {
  it("adds the files added since and deletes the ones taken out", () => {
    const before = theme({ custom: [brandon] });
    const after = theme({
      custom: [
        { ...brandon, files: brandon.files.slice(0, 2) },
        { family: "Vary", files: [{ src: "/media/fonts/vary-100-900.woff2", weight: 100, weightTo: 900 }] },
      ],
    });
    const bytes = new Uint8Array([1]);
    expect(customFontFileChanges(before, after, { "public/media/fonts/vary-100-900.woff2": bytes })).toEqual([
      { path: "public/media/fonts/vary-100-900.woff2", bytes },
      { path: "public/media/fonts/brandon-400-italic.woff2", delete: true },
    ]);
    expect(customFontFileChanges(before, before, {})).toEqual([]);
  });
});
