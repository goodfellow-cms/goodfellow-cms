import { describe, expect, it } from "vitest";
import { fakeThemes } from "./testing.js";
import {
  chooseThemeRelease,
  fetchTheme,
  isThemeName,
  searchThemes,
  type ThemeRelease,
  themeLabel,
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
