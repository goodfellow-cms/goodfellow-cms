import { describe, expect, it } from "vitest";
import { fetchLanguagePack, isLanguagePackName, languagePackReleases, searchLanguagePacks } from "./language-packs.js";
import { PackageError } from "./npm-packages.js";
import { fakeLanguagePacks, sampleLanguagePackFiles } from "./testing.js";

const NOW = new Date("2026-10-01T00:00:00Z");

describe("reading language packs from npm", () => {
  const fake = fakeLanguagePacks({
    now: NOW,
    packs: [
      {
        name: "goodfellow-language-fr",
        description: "French.",
        releases: [{ version: "1.0.0", goodfellow: ">=0.9.0", files: sampleLanguagePackFiles() }],
      },
      { name: "french-language", releases: [{ version: "1.0.0", files: sampleLanguagePackFiles() }] },
      { name: "goodfellow-language-empty", releases: [{ version: "1.0.0", files: {} }] },
      {
        name: "goodfellow-language-bad",
        releases: [{ version: "1.0.0", files: sampleLanguagePackFiles({ code: "not a code" }) }],
      },
      {
        name: "goodfellow-language-broken",
        releases: [{ version: "1.0.0", files: { "goodfellow-language.json": "{" } }],
      },
    ],
  });

  it("knows language packs' names", () => {
    expect(isLanguagePackName("goodfellow-language-fr")).toBe(true);
    expect(isLanguagePackName("@acme/goodfellow-language-pt-br")).toBe(true);
    expect(isLanguagePackName("goodfellow-theme-fr")).toBe(false);
    expect(isLanguagePackName("goodfellow-language-")).toBe(false);
  });

  it("lists only packages named as language packs with the keyword", async () => {
    const found = await searchLanguagePacks("", { fetch: fake.fetch });
    expect(found.map((pack) => pack.name)).toEqual([
      "goodfellow-language-fr",
      "goodfellow-language-empty",
      "goodfellow-language-bad",
      "goodfellow-language-broken",
    ]);
    expect(await searchLanguagePacks("french", { fetch: fake.fetch })).toHaveLength(1);
  });

  it("refuses to read the releases of a package not named as one", async () => {
    await expect(languagePackReleases("french-language", { fetch: fake.fetch })).rejects.toMatchObject({
      code: "not-a-language-pack",
    });
  });

  it("reads a release's text, checking it", async () => {
    const [release] = await languagePackReleases("goodfellow-language-fr", { fetch: fake.fetch });
    if (!release) throw new Error("No release.");
    const pack = await fetchLanguagePack({ ...release, name: "goodfellow-language-fr" }, { fetch: fake.fetch });
    expect(pack).toMatchObject({ name: "goodfellow-language-fr", release: "1.0.0", goodfellow: ">=0.9.0" });
    expect(pack.manifest.code).toBe("fr");
    expect(pack.manifest.strings["publish.button"]).toEqual({ text: "Publier", reviewed: true });
  });

  it("says what's wrong with a package that isn't one", async () => {
    const read = (name: string) =>
      fetchLanguagePack(
        { name, version: "1.0.0", published: NOW.toISOString(), provenance: false },
        { fetch: fake.fetch },
      );
    await expect(read("goodfellow-language-empty")).rejects.toMatchObject({ code: "not-a-language-pack" });
    await expect(read("goodfellow-language-bad")).rejects.toMatchObject({ code: "bad-file" });
    await expect(read("goodfellow-language-broken")).rejects.toBeInstanceOf(PackageError);
  });
});
