import { describe, expect, it } from "vitest";
import type { LayoutFile } from "./content/schemas.js";
import type { ThemePackage } from "./content/themes.js";
import { fakeThemes } from "./testing.js";
import {
  chooseThemeRelease,
  fetchTheme,
  isThemeName,
  searchThemes,
  type ThemeRelease,
  themeLabel,
  themeLoads,
  themeReleases,
  themeUnknownBlocks,
} from "./themes.js";
import { sampleThemeFiles } from "./themes-testing.js";
import { inRange } from "./updates.js";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("inRange", () => {
  it("reads the ranges npm writes", () => {
    expect(inRange("0.31.2", "^0.31.0")).toBe(true);
    expect(inRange("0.32.0", "^0.31.0")).toBe(false);
    expect(inRange("1.4.0", "^1.2.0")).toBe(true);
    expect(inRange("2.0.0", "^1.2.0")).toBe(false);
    expect(inRange("0.0.4", "^0.0.3")).toBe(false);
    expect(inRange("0.31.9", "~0.31.2")).toBe(true);
    expect(inRange("0.31.1", "~0.31.2")).toBe(false);
    expect(inRange("0.40.0", ">=0.31.0 <1.0.0")).toBe(true);
    expect(inRange("1.0.0", ">=0.31.0 <1.0.0")).toBe(false);
    expect(inRange("0.31.5", "0.31.x")).toBe(true);
    expect(inRange("0.32.0", "0.31")).toBe(false);
    expect(inRange("0.33.0", "^0.31.0 || ^0.33.0")).toBe(true);
    expect(inRange("0.35.0", "0.31.0 - 0.35")).toBe(true);
    expect(inRange("0.36.0", "0.31.0 - 0.35")).toBe(false);
    expect(inRange("0.31.0", "*")).toBe(true);
    expect(inRange("0.31.0", ">= 0.30")).toBe(true);
  });

  it("never matches ranges it can't read, or pre-releases", () => {
    expect(inRange("0.31.0", "latest")).toBe(false);
    expect(inRange("0.31.0", "^0.31.0-beta.1")).toBe(false);
    expect(inRange("0.31.0-beta.1", "*")).toBe(false);
  });
});

describe("theme names", () => {
  it("are goodfellow-theme-<name>, scoped or not", () => {
    expect(isThemeName("goodfellow-theme-harbor")).toBe(true);
    expect(isThemeName("@acme/goodfellow-theme-harbor")).toBe(true);
    expect(isThemeName("harbor-theme")).toBe(false);
    expect(isThemeName("goodfellow-theme-")).toBe(false);
    expect(themeLabel("@acme/goodfellow-theme-quiet-harbor")).toBe("Quiet harbor");
  });
});

const release = (version: string, days: number, goodfellow = "^0.31.0", extra: Partial<ThemeRelease> = {}) => ({
  version,
  published: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
  goodfellow,
  provenance: false,
  ...extra,
});

describe("chooseThemeRelease", () => {
  it("offers the newest release that's old enough and works with this Goodfellow release", () => {
    const releases = [release("1.0.0", 40), release("1.1.0", 10), release("1.2.0", 1), release("2.0.0", 30, "^0.32.0")];
    const choice = chooseThemeRelease(releases, "0.31.4", NOW);
    expect(choice.release?.version).toBe("1.1.0");
    expect(choice.waiting?.version).toBe("1.2.0");
    expect(choice.incompatible?.version).toBe("2.0.0");
  });

  it("leaves out deprecated releases and ones that don't say which Goodfellow releases they work with", () => {
    const releases = [
      release("1.0.0", 40),
      release("1.1.0", 10, "^0.31.0", { deprecated: "Broke headings." }),
      { ...release("1.2.0", 10), goodfellow: undefined },
    ];
    const choice = chooseThemeRelease(releases, "0.31.4", NOW);
    expect(choice.release?.version).toBe("1.0.0");
    expect(choice.incompatible?.version).toBe("1.2.0");
  });
});

describe("reading themes from npm", () => {
  const fake = fakeThemes({
    now: NOW,
    themes: [
      {
        name: "goodfellow-theme-harbor",
        description: "Navy and cream.",
        publisher: "harbor-studio",
        releases: [
          {
            version: "1.0.0",
            goodfellow: "^0.31.0",
            provenance: true,
            repository: "https://github.com/harbor-studio/goodfellow-theme-harbor",
            files: sampleThemeFiles({ header: true }),
          },
        ],
      },
      { name: "harbor-theme", releases: [{ version: "1.0.0", files: sampleThemeFiles() }] },
      {
        name: "goodfellow-theme-untagged",
        keywords: ["theme"],
        releases: [{ version: "1.0.0", files: sampleThemeFiles() }],
      },
      { name: "goodfellow-theme-empty", releases: [{ version: "1.0.0", files: {} }] },
    ],
  });

  it("lists only packages named as themes with the theme keyword", async () => {
    const found = await searchThemes("", { fetch: fake.fetch });
    expect(found.map((theme) => theme.name)).toEqual(["goodfellow-theme-harbor", "goodfellow-theme-empty"]);
    expect(found[0]).toEqual({
      name: "goodfellow-theme-harbor",
      version: "1.0.0",
      description: "Navy and cream.",
      publisher: "harbor-studio",
    });
    expect(await searchThemes("navy", { fetch: fake.fetch })).toHaveLength(1);
  });

  it("reads releases with provenance and the repository npm checked", async () => {
    const [first] = await themeReleases("goodfellow-theme-harbor", { fetch: fake.fetch });
    expect(first).toEqual({
      version: "1.0.0",
      published: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
      goodfellow: "^0.31.0",
      provenance: true,
      repository: "https://github.com/harbor-studio/goodfellow-theme-harbor",
    });
  });

  it("reads a release's files, checking them", async () => {
    const [first] = await themeReleases("goodfellow-theme-harbor", { fetch: fake.fetch });
    const theme = await fetchTheme(
      { name: "goodfellow-theme-harbor", ...(first as ThemeRelease) },
      { fetch: fake.fetch },
    );
    expect(theme.manifest.title).toBe("Harbor");
    expect(theme.css).toContain(".gf-card");
    expect(theme.header?.data.content[0]?.type).toBe("Section");
    expect(theme.goodfellow).toBe("^0.31.0");
    expect(themeUnknownBlocks(theme, ["Section", "SiteBrand"])).toEqual(["Menu"]);
    await expect(
      fetchTheme({ name: "goodfellow-theme-empty", ...(first as ThemeRelease) }, { fetch: fake.fetch }),
    ).rejects.toMatchObject({ code: "not-a-theme" });
  });
});

describe("what a theme's header and footer may do", () => {
  const withLayout = (content: LayoutFile["data"]["content"], parts: Record<string, string> = {}): ThemePackage => ({
    name: "goodfellow-theme-test",
    release: "1.0.0",
    manifest: {
      version: 1 as const,
      title: "Test",
      theme: { colors: {}, fonts: {}, parts },
    },
    header: { version: 1 as const, data: { root: { props: {} }, content } },
  });

  it("uses only built-in blocks that load and run nothing, even where the site has others", () => {
    const theme = withLayout([
      { type: "Section", props: { id: "a", content: [{ type: "custom-html", props: { id: "b", html: "<script>" } }] } },
      { type: "Image", props: { id: "c", src: "" } },
    ]);
    expect(themeUnknownBlocks(theme, ["Section", "Image", "custom-html"])).toEqual(["Image", "custom-html"]);
  });

  it("lists what its classes and pictures would load", () => {
    const theme = withLayout(
      [{ type: "Section", props: { id: "a", backgroundImage: "https://images.example/sea.jpg", className: "" } }],
      // Put together here, so Tailwind, which reads this repository's files, never finds the class.
      { "gf-card": ["bg-[url(", "https://tracker.example/pixel.gif", ")]"].join("") },
    );
    expect(themeLoads(theme)).toEqual(["https://images.example/sea.jpg", "https://tracker.example/pixel.gif"]);
  });

  it("lists every address its header and footer would load, whatever it ends in, and in HTML however it's quoted", () => {
    const section = (backgroundImage: string) => ({ type: "Section", props: { id: "a", backgroundImage } });
    const text = (html: string) => ({ type: "Text", props: { id: "t", text: html } });
    for (const [block, address] of [
      [section("https://tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("https://tracker.example/p.png/x"), "https://tracker.example/p.png/x"],
      [section("//tracker.example/a)b"), "https://tracker.example/a)b"],
      // Every spelling a browser reads as another site's address, from one of the site's pages.
      [section("\\\\tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("/\\tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("\\/tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("https:\\\\tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("\u0001//tracker.example/pixel"), "https://tracker.example/pixel"],
      [section(" HTTPS://TRACKER.example/pixel"), "https://tracker.example/pixel"],
      // A scheme without its slashes is read by the page's, so it leaves a page at http://.
      [section("https:tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("HTTPS:/tracker.example/pixel"), "https://tracker.example/pixel"],
      [section("http:tracker.example/pixel"), "http://tracker.example/pixel"],
      [text("<img src=https://tracker.example/pixel>"), "https://tracker.example/pixel"],
      [text('<img srcset="/media/a.png 1x, https://tracker.example/pixel 2x">'), "https://tracker.example/pixel"],
      // A srcset's address may hold commas, and descriptors' parentheses too, as browsers read them.
      [text('<img srcset="https://tracker.example/a,b 1x,/media/b.png 2x">'), "https://tracker.example/a,b"],
      [text('<img srcset="/media/a.png (x, y) 1x,, https://tracker.example/c,">'), "https://tracker.example/c"],
      // The first `)` ends them, however many `(` came before.
      [text('<img srcset="/media/a.png ((x), https://tracker.example/q 2x">'), "https://tracker.example/q"],
      // Character references are read as the browser reads them.
      [text('<img srcset="https://tracker.example/p?a=1&amp;b=2 1x">'), "https://tracker.example/p?a=1&b=2"],
      [text("<img src='&sol;&#47;tracker.example&#x2F;q'>"), "//tracker.example/q"],
      // A reference to whitespace separates candidates, as browsers read it, so none hides inside another.
      [text('<img srcset="/media/a.png&Tab;1x,https://tracker.example/t 2x">'), "https://tracker.example/t"],
      [text('<img srcset="/media/a.png&NewLine;1x&comma;https://tracker.example/n 2x">'), "https://tracker.example/n"],
      // Numeric references without their ";", and with as many digits as they like.
      [text('<img srcset="/media/a.png&#9,https://tracker.example/s 2x">'), "https://tracker.example/s"],
      [text('<img srcset="/media/a.png&#x00000000009;1x,https://tracker.example/z 2x">'), "https://tracker.example/z"],
      [text("<video poster='https://tracker.example/still'>"), "https://tracker.example/still"],
    ] as const) {
      expect(themeLoads(withLayout([block])), address).toEqual([address]);
    }
    // A link's address is only followed when someone chooses it, and the site's own media and Google Fonts load
    // from where the site does already.
    const button = { type: "Button", props: { id: "b", label: "Shop", href: "https://shop.example/" } };
    // Words that are an address are only shown, and a setting that's a link only followed.
    const words = { type: "Heading", props: { id: "h", text: "https://stanne.example.org" } };
    const linked = {
      type: "SiteBrand",
      props: { id: "s", url: "https://stanne.example.org/", link: "//shop.example/" },
    };
    expect(themeLoads(withLayout([button, words, linked, section("/media/sea.jpg")]))).toEqual([]);
  });

  it("refuses a theme whose header holds an address that would run code", async () => {
    const files = sampleThemeFiles({ header: true });
    files["header.json"] = (files["header.json"] ?? "").replace('"menu": "main"', '"menu": "javascript:alert(1)"');
    const fake = fakeThemes({
      now: NOW,
      themes: [{ name: "goodfellow-theme-bad", releases: [{ version: "1.0.0", files }] }],
    });
    const [first] = await themeReleases("goodfellow-theme-bad", { fetch: fake.fetch });
    await expect(
      fetchTheme({ name: "goodfellow-theme-bad", ...(first as ThemeRelease) }, { fetch: fake.fetch }),
    ).rejects.toMatchObject({ code: "bad-file" });
  });
});
