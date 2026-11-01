import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";
import { fetchFontsAsset, fontStandIns, hostFonts, selfHostFonts } from "./node-fonts.js";
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

describe("hostFonts", () => {
  const css = "@font-face { src: url(https://fonts.gstatic.com/s/lora/v1/a.woff2) format('woff2'); }";
  const site = theme({ body: "Lora" });

  it("writes a full-stack site's fonts into public/, in place of an earlier build's, and says where they are", async () => {
    const pub = await mkdtemp(join(tmpdir(), "goodfellow-public-"));
    try {
      await mkdir(join(pub, "fonts/google/s/old"), { recursive: true });
      await writeFile(join(pub, "fonts/google/s/old/b.woff2"), "old");
      await mkdir(join(pub, "fonts/mine"), { recursive: true });
      await writeFile(join(pub, "fonts/mine/c.woff2"), "the site's own");
      const fonts = await hostFonts(pub, site, {
        read: async () => css,
        readFont: async () => new Uint8Array([1, 2, 3]),
      });
      expect(fonts).toEqual({
        source: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap",
        stylesheet: expect.stringMatching(/^fonts\/google\/[0-9a-f]{8}\.css$/),
        fonts: [{ url: "https://fonts.gstatic.com/s/lora/v1/a.woff2", path: "fonts/google/s/lora/v1/a.woff2" }],
      });
      expect(new Uint8Array(await readFile(join(pub, "fonts/google/s/lora/v1/a.woff2")))).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(await readFile(join(pub, (fonts as { stylesheet: string }).stylesheet), "utf8")).toContain(
        "url(s/lora/v1/a.woff2)",
      );
      expect(existsSync(join(pub, "fonts/google/s/old/b.woff2"))).toBe(false);
      // The site's own fonts beside them stay.
      expect(await readFile(join(pub, "fonts/mine/c.woff2"), "utf8")).toBe("the site's own");

      // Where Google can't be reached, what's there stays: another of the build's processes may have written it.
      expect(await hostFonts(pub, site, { read: async () => undefined })).toEqual({ unavailable: true });
      expect(existsSync(join(pub, (fonts as { stylesheet: string }).stylesheet))).toBe(true);
      expect(await hostFonts(pub, theme({}))).toBeUndefined();
      expect(existsSync(join(pub, "fonts/google"))).toBe(false);
    } finally {
      await rm(pub, { recursive: true, force: true });
    }
  });
});

describe("fetchFontsAsset", () => {
  const url = "https://fonts.googleapis.com/css2?family=Inter";
  const answers = (...replies: Array<Response | Error>) => {
    const asked: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      const reply = replies.shift();
      if (!reply || reply instanceof Error) throw reply ?? new Error("no more answers");
      return reply;
    }) as typeof globalThis.fetch;
    return { fetch, asked };
  };
  const waited: number[] = [];
  const wait = async (ms: number) => {
    waited.push(ms);
  };

  it("asks again after a failed connection or an answer saying to try later, as a build's processes may all ask at once", async () => {
    waited.length = 0;
    const { fetch, asked } = answers(
      new TypeError("fetch failed"),
      new Response("", { status: 503 }),
      new Response("css"),
    );
    const response = await fetchFontsAsset(url, { timeout: 1000 }, { fetch, wait, delays: [10, 20] });
    expect(await response?.text()).toBe("css");
    expect(asked).toHaveLength(3);
    expect(waited).toEqual([10, 20]);
  });

  it("gives up after its last try, and at once on an answer that won't change", async () => {
    waited.length = 0;
    const failing = answers(
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    );
    expect(
      await fetchFontsAsset(url, { timeout: 1000 }, { fetch: failing.fetch, wait, delays: [10, 20] }),
    ).toBeUndefined();
    expect(failing.asked).toHaveLength(3);

    const missing = answers(new Response("", { status: 404 }));
    expect(
      await fetchFontsAsset(url, { timeout: 1000 }, { fetch: missing.fetch, wait, delays: [10, 20] }),
    ).toBeUndefined();
    expect(missing.asked).toHaveLength(1);
  });
});
