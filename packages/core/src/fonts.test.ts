import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";
import { fontFilesFor, fontPreloads } from "./fonts.js";

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
