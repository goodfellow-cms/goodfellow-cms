import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";
import { fontStandIns, selfHostFonts } from "./node-fonts.js";
import { themeToCss } from "./theme.js";

const theme = (fonts: object) => siteSettingsSchema.parse({ version: 1, theme: { fonts } }).theme;

describe("fontStandIns", () => {
  it("resizes the computer's own fonts of each font's kind to take the same space", async () => {
    const site = theme({ heading: "Fraunces", headingCategory: "serif", body: "Inter", bodyCategory: "sans-serif" });
    const standIns = await fontStandIns(site);
    expect(standIns.heading).toEqual([
      "Fraunces fallback (Times New Roman)",
      "Fraunces fallback (Georgia)",
      "Fraunces fallback (Liberation Serif)",
      "Fraunces fallback (Noto Serif)",
    ]);
    expect(standIns.body).toEqual([
      "Inter fallback (Arial)",
      "Inter fallback (Roboto)",
      "Inter fallback (Liberation Sans)",
      "Inter fallback (Noto Sans)",
    ]);
    expect(standIns.css).toMatch(
      /@font-face \{ font-family: "Fraunces fallback \(Times New Roman\)"; src: local\("Times New Roman"\); size-adjust: [\d.]+%;/,
    );
    expect(standIns.css.match(/@font-face/g)).toHaveLength(8);
    // Liberation's fonts are sized as the fonts they're made to match.
    const size = (font: string) => new RegExp(`local\\("${font}"\\); size-adjust: ([\\d.]+)%`).exec(standIns.css)?.[1];
    expect(size("Liberation Serif")).toBe(size("Times New Roman"));

    // Pages try each in turn, then the computer's fonts of the same kind.
    const css = themeToCss(site, standIns);
    expect(css).toContain(
      '--gf-font-heading:"Fraunces", "Fraunces fallback (Times New Roman)", "Fraunces fallback (Georgia)", "Fraunces fallback (Liberation Serif)", "Fraunces fallback (Noto Serif)", ui-serif,',
    );
    expect(css).toContain('--gf-font-body:"Inter", "Inter fallback (Arial)",');
    expect(css.startsWith("@font-face {")).toBe(true);
  });

  it("works out a font's kind from its measurements when the site doesn't say, and shares one font's stand-ins", async () => {
    const standIns = await fontStandIns(theme({ heading: "Lora", body: "Lora" }));
    expect(standIns.heading?.[0]).toBe("Lora fallback (Times New Roman)");
    expect(standIns.body).toEqual(standIns.heading);
    expect(standIns.css.match(/@font-face/g)).toHaveLength(4);
  });

  it("gives none for fonts it has no measurements for, or no fonts", async () => {
    expect(await fontStandIns(theme({ heading: "No Such Font" }))).toEqual({ css: "" });
    expect(await fontStandIns(theme({}))).toEqual({ css: "" });
  });
});

describe("selfHostFonts", () => {
  const css = `/* latin */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v1/a.woff2) format('woff2');
}`;
  const site = theme({ body: "Lora" });

  it("writes the fonts into the build and points every page and payload at them", async () => {
    const out = await mkdtemp(join(tmpdir(), "goodfellow-fonts-"));
    try {
      await mkdir(join(out, "about"), { recursive: true });
      const link = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&amp;display=swap"/>`;
      await writeFile(join(out, "about/index.html"), `<head>${link}</head>`);
      await writeFile(join(out, "about.txt"), "https://fonts.gstatic.com/s/lora/v1/a.woff2");
      const result = await selfHostFonts(out, site, {
        base: "/site/",
        read: async () => css,
        readFont: async () => new Uint8Array([1, 2, 3]),
      });
      expect(result).toEqual({ hosted: 1 });
      expect(new Uint8Array(await readFile(join(out, "fonts/google/s/lora/v1/a.woff2")))).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      const html = await readFile(join(out, "about/index.html"), "utf8");
      const stylesheet = /href="\/site\/(fonts\/google\/[0-9a-f]+\.css)"/.exec(html)?.[1];
      expect(stylesheet).toBeDefined();
      expect(await readFile(join(out, stylesheet ?? ""), "utf8")).toContain("url(s/lora/v1/a.woff2)");
      expect(await readFile(join(out, "about.txt"), "utf8")).toBe("/site/fonts/google/s/lora/v1/a.woff2");

      // Without Google, pages are left as they were.
      await writeFile(join(out, "about/index.html"), `<head>${link}</head>`);
      expect(await selfHostFonts(out, site, { read: async () => undefined })).toEqual({ unavailable: true });
      expect(await readFile(join(out, "about/index.html"), "utf8")).toBe(`<head>${link}</head>`);
      expect(await selfHostFonts(out, theme({}))).toBeUndefined();
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
