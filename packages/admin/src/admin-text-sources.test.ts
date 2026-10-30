import { type AdminTextFile, englishHash } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import {
  adminTextSources,
  filterSources,
  labelSources,
  languageStatus,
  sourceKey,
  sourcesToTranslate,
  withEdits,
  withTranslations,
} from "./admin-text-sources.js";
import { PUCK_ENGLISH } from "./languages/en-puck.js";
import { puck as spanishPuck } from "./languages/es-puck.js";
import { defaultStrings } from "./strings.js";

const description = {
  root: { fields: { title: { type: "text", label: "Page title" } } },
  blocks: {
    Hero: {
      label: "Hero",
      fields: {
        size: {
          type: "select",
          label: "Size",
          options: [
            { label: "Small", value: "sm" },
            { label: "Large", value: "lg" },
          ],
        },
        links: {
          type: "array",
          label: "Links",
          arrayFields: { text: { type: "text", label: "Link text", placeholder: "Read more" } },
        },
      },
    },
  },
};

describe("what the admin panel says", () => {
  it("knows Puck's English for every Puck string Goodfellow translates", () => {
    expect(Object.keys(PUCK_ENGLISH).sort()).toEqual(Object.keys(spanishPuck).sort());
  });

  it("lists the site's blocks' labels, choices and placeholders, with any more given", () => {
    expect(labelSources(description, ["Layout"])).toEqual([
      "Hero",
      "Large",
      "Layout",
      "Link text",
      "Links",
      "Page title",
      "Read more",
      "Size",
      "Small",
    ]);
  });

  it("lists every table's strings once, by table", () => {
    const sources = adminTextSources(["Size"]);
    expect(sources).toHaveLength(Object.keys(defaultStrings).length + Object.keys(PUCK_ENGLISH).length + 1);
    expect(sources).toContainEqual({ key: "strings:publish.button", english: "Publish", table: "strings" });
    expect(sources).toContainEqual({ key: "puck:header-publish", english: "Publish", table: "puck" });
    expect(sources).toContainEqual({ key: "labels:Size", english: "Size", table: "labels" });
  });
});

describe("a language's translation", () => {
  const sources = adminTextSources(["Size"]).filter((source) =>
    ["strings:publish.button", "strings:nav.pages", "strings:deletePage.title", "labels:Size"].includes(source.key),
  );
  const file: AdminTextFile = {
    version: 1,
    name: "Français",
    strings: {
      "publish.button": { text: "Publier", source: englishHash("Publish"), reviewed: true },
      "nav.pages": { text: "Pages", source: englishHash("Old pages") },
      "deletePage.title": { text: "Supprimer ?" },
    },
    puck: {},
    labels: {},
  };

  it("counts what's current, out of date, unusable and missing", () => {
    expect(languageStatus(file, sources)).toEqual({
      total: 4,
      current: 1,
      outdated: 1,
      unusable: 1,
      missing: 1,
      reviewed: 1,
    });
  });

  it("translates what's missing or unusable, and what's out of date when asked", () => {
    expect(sourcesToTranslate(file, sources).map((source) => source.key)).toEqual([
      "strings:deletePage.title",
      "labels:Size",
    ]);
    expect(sourcesToTranslate(file, sources, { outdated: true }).map((source) => source.key)).toEqual([
      "strings:nav.pages",
      "strings:deletePage.title",
      "labels:Size",
    ]);
    expect(sourcesToTranslate(undefined, sources)).toHaveLength(4);
  });

  it("puts new translations in the file with their English's hash, keeping the rest", () => {
    const next = withTranslations(
      file,
      "Français",
      new Map([
        [sourceKey("strings", "nav.pages"), "Les pages"],
        [sourceKey("labels", "Size"), "Taille"],
        ["strings:not.asked", "Ignoré"],
      ]),
      sources,
    );
    expect(next.strings["nav.pages"]).toEqual({ text: "Les pages", source: englishHash(defaultStrings["nav.pages"]) });
    expect(next.strings["publish.button"]).toEqual(file.strings["publish.button"]);
    expect(next.labels.Size).toEqual({ text: "Taille", source: englishHash("Size") });
    expect(next.strings).not.toHaveProperty("not.asked");
    expect(withTranslations(undefined, "Deutsch", new Map(), sources)).toEqual({
      version: 1,
      name: "Deutsch",
      strings: {},
      puck: {},
      labels: {},
    });
  });

  it("finds strings by their English, key or text, and by where they stand", () => {
    const keys = (found: { key: string }[]) => found.map((source) => source.key);
    expect(keys(filterSources(file, sources, { query: "PUBLISH" }))).toEqual(["strings:publish.button"]);
    expect(keys(filterSources(file, sources, { query: "publier" }))).toEqual(["strings:publish.button"]);
    expect(keys(filterSources(file, sources, { query: "delete title" }))).toEqual(["strings:deletePage.title"]);
    expect(keys(filterSources(file, sources, { show: "missing" }))).toEqual(["labels:Size"]);
    expect(keys(filterSources(file, sources, { show: "outdated" }))).toEqual(["strings:nav.pages"]);
    expect(keys(filterSources(file, sources, { show: "unusable" }))).toEqual(["strings:deletePage.title"]);
    // Current strings no one has read: none here, since the only current one is reviewed.
    expect(keys(filterSources(file, sources, { show: "unreviewed" }))).toEqual([]);
    expect(filterSources(file, sources)).toHaveLength(4);
  });

  it("writes an owner's edits against today's English, and takes emptied ones out", () => {
    const next = withEdits(
      file,
      "Français",
      new Map([
        [sourceKey("strings", "nav.pages"), { text: " Les pages ", reviewed: true }],
        [sourceKey("strings", "publish.button"), { text: "", reviewed: false }],
        [sourceKey("labels", "Size"), { text: "Taille", reviewed: false }],
        ["strings:not.asked", { text: "Ignoré", reviewed: true }],
      ]),
      sources,
    );
    expect(next.strings["nav.pages"]).toEqual({
      text: "Les pages",
      source: englishHash(defaultStrings["nav.pages"]),
      reviewed: true,
    });
    expect(next.strings).not.toHaveProperty("publish.button");
    expect(next.labels.Size).toEqual({ text: "Taille", source: englishHash("Size") });
    expect(next.strings).not.toHaveProperty("not.asked");
    expect(next.strings["deletePage.title"]).toEqual(file.strings["deletePage.title"]);
  });

  it("keeps a language pack's record and marks, so an update knows what's still the pack's", () => {
    const packed: AdminTextFile = {
      ...file,
      strings: { "nav.pages": { text: "Pages", pack: englishHash("Pages") } },
      pack: { name: "goodfellow-language-fr", release: "1.0.0" },
    };
    const read = withEdits(
      packed,
      "Français",
      new Map([["strings:nav.pages", { text: "Pages", reviewed: true }]]),
      sources,
    );
    expect(read.pack).toEqual(packed.pack);
    expect(read.strings["nav.pages"]).toMatchObject({ text: "Pages", reviewed: true, pack: englishHash("Pages") });
    const translated = withTranslations(packed, "Français", new Map([["strings:nav.pages", "Les pages"]]), sources);
    expect(translated.pack).toEqual(packed.pack);
    // The mark stays the pack's text's hash, so the new text is no longer the pack's.
    expect(translated.strings["nav.pages"]?.pack).toBe(englishHash("Pages"));
  });
});
