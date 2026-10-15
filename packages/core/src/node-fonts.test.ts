import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";
import { fontStandIns } from "./node-fonts.js";
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
