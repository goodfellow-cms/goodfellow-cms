import { describe, expect, it } from "vitest";
import { entryFileChange } from "./changes.js";
import {
  choiceSlug,
  choicesOf,
  type Entry,
  entryFieldProblems,
  formatFieldValue,
  isDateValue,
  isEmptyValue,
  richTextToPlainText,
  sortEntries,
} from "./collections.js";
import { addressPatternProblem, entryAddress } from "./paths.js";
import type { CollectionField } from "./schemas.js";
import { collectionFileSchema } from "./schemas.js";

const fields: CollectionField[] = [
  { name: "title", label: "Title", type: "text" },
  { name: "date", label: "Date", type: "date" },
  { name: "views", label: "Views", type: "number" },
  { name: "kind", label: "Kind", type: "select", options: [{ value: "homily", label: "Homily" }] },
  { name: "body", label: "Text", type: "richtext" },
  {
    name: "topics",
    label: "Topics",
    type: "tags",
    options: [
      { value: "music", label: "Music" },
      { value: "youth", label: "Youth ministry" },
    ],
  },
];

const entry = (slug: string, values: Record<string, unknown>): Entry => ({
  collection: "videos",
  slug,
  file: `content/collections/videos/${slug}.json`,
  content: { version: 1, fields: values },
});

describe("address patterns", () => {
  it("accepts patterns with {slug} as one whole part", () => {
    expect(addressPatternProblem("/videos/{slug}")).toBeUndefined();
    expect(addressPatternProblem("/{slug}")).toBeUndefined();
    expect(addressPatternProblem("/events/{slug}/details")).toBeUndefined();
  });

  it.each(["videos/{slug}", "/videos", "/videos/{slug}/{slug}", "/videos/v-{slug}", "/Videos/{slug}"])(
    "rejects %s",
    (pattern) => {
      expect(addressPatternProblem(pattern)).toBeTypeOf("string");
    },
  );

  it("fills in an entry's address", () => {
    expect(entryAddress("/videos/{slug}", "easter-vigil")).toBe("/videos/easter-vigil");
  });
});

describe("collection files", () => {
  const valid = { version: 1, name: "Videos", entryName: "Video", fields };

  it("accepts a collection and fills in an empty template", () => {
    const parsed = collectionFileSchema.parse(valid);
    expect(parsed.template).toEqual({ root: {}, content: [] });
  });

  it("requires a text field named title", () => {
    const result = collectionFileSchema.safeParse({ ...valid, fields: fields.slice(1) });
    expect(result.error?.issues[0]?.message).toMatch(/title/);
  });

  it("rejects repeated field names, choices without options and unknown sort fields", () => {
    const result = collectionFileSchema.safeParse({
      ...valid,
      fields: [
        ...fields,
        { name: "date", label: "Again", type: "text" },
        { name: "pick", label: "Pick", type: "select" },
      ],
      sort: { field: "missing", order: "asc" },
      path: "/videos",
    });
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "fields.6.name",
      "fields.7.options",
      "path",
      "sort.field",
    ]);
  });
});

describe("language paths and names", () => {
  const valid = { version: 1, name: "Videos", entryName: "Video", fields };

  it("puts each language's items under its own code, which says what language a page is in", () => {
    const parse = (languagePaths: Record<string, string>) =>
      collectionFileSchema.safeParse({ ...valid, path: "/videos/{slug}", languagePaths });
    expect(parse({ es: "/es/videos/{slug}" }).success).toBe(true);
    expect(parse({ es: "/videos-es/{slug}" }).error?.issues[0]?.message).toMatch(/must start with "\/es\/"/);
    // A code with capitals has a lowercase address.
    expect(parse({ "pt-BR": "/pt-br/videos/{slug}" }).success).toBe(true);
  });

  it("writes no file for a collection or item whose name isn't one part of an address", () => {
    const collection = { id: "videos", settings: collectionFileSchema.parse(valid) };
    expect(entryFileChange(collection, "advent", { title: "Advent" }, undefined).path).toBe(
      "content/collections/videos/advent.json",
    );
    expect(() => entryFileChange(collection, "_collection", { title: "x" }, undefined)).toThrow();
    expect(() => entryFileChange({ ...collection, id: "../pages" }, "about", { title: "x" }, undefined)).toThrow();
  });
});

describe("entry values", () => {
  it("accepts matching and missing values", () => {
    expect(entryFieldProblems(fields, { title: "Easter", date: "2026-04-05", views: 3, kind: "homily" })).toEqual([]);
    expect(entryFieldProblems(fields, {})).toEqual([]);
    expect(entryFieldProblems(fields, { date: "", kind: "", other: 5 })).toEqual([]);
  });

  it("reports values of the wrong kind", () => {
    expect(entryFieldProblems(fields, { title: 5, date: "April 5", views: "3", kind: "talk" })).toEqual([
      "title must be text",
      "date must be a date written as YYYY-MM-DD",
      "views must be a number",
      "kind must be one of: homily",
    ]);
  });

  it("takes only dates that exist", () => {
    expect(isDateValue("2028-02-29")).toBe(true);
    expect(isDateValue("2026-02-29")).toBe(false);
    expect(isDateValue("2026-02-30")).toBe(false);
    expect(isDateValue("2026-13-01")).toBe(false);
    expect(entryFieldProblems(fields, { date: "2026-04-31" })).toEqual(["date must be a date written as YYYY-MM-DD"]);
  });

  it("formats values for placeholders", () => {
    expect(formatFieldValue(fields[1], "2026-12-24", "en")).toBe("December 24, 2026");
    expect(formatFieldValue(fields[1], "2026-12-24", "es")).toBe("24 de diciembre de 2026");
    expect(formatFieldValue(fields[3], "homily")).toBe("Homily");
    expect(formatFieldValue(fields[4], "<p>Hello &amp; <b>welcome</b></p><p>all</p>")).toBe("Hello & welcome all");
    expect(formatFieldValue(fields[2], 12)).toBe("12");
    expect(formatFieldValue(fields[0], undefined)).toBe("");
  });

  it("treats empty rich text as empty", () => {
    expect(isEmptyValue("<p></p>")).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue("<p><br></p><p><strong> </strong></p>")).toBe(true);
    // What shows without words isn't empty.
    expect(isEmptyValue('<p><img src="/media/a.jpg" alt=""></p>')).toBe(false);
    expect(isEmptyValue('<iframe src="https://www.youtube-nocookie.com/embed/x"></iframe>')).toBe(false);
    expect(isEmptyValue("<hr>")).toBe(false);
    expect(isEmptyValue("<table><tr><td></td></tr></table>")).toBe(false);
    expect(richTextToPlainText("<p>a</p><ul><li>b</li></ul>")).toBe("a b");
  });
});

describe("tags", () => {
  const topics = fields[5];

  it("hold any number of the field's choices", () => {
    expect(entryFieldProblems(fields, { topics: ["music", "youth"] })).toEqual([]);
    expect(entryFieldProblems(fields, { topics: [] })).toEqual([]);
    expect(entryFieldProblems(fields, { topics: ["sport"] })).toEqual(["topics must be a list of: music, youth"]);
    expect(entryFieldProblems(fields, { topics: "music" })).toEqual(["topics must be a list of: music, youth"]);
    expect(formatFieldValue(topics, ["youth", "music"])).toBe("Youth ministry, Music");
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(["music"])).toBe(false);
  });

  it("are listed like a choice field's choice", () => {
    expect(choicesOf(topics, ["music", 5])).toEqual(["music"]);
    expect(choicesOf(fields[3], "homily")).toEqual(["homily"]);
    expect(choicesOf(fields[3], "")).toEqual([]);
  });

  it("go into addresses without spaces or accents", () => {
    expect(choiceSlug("Youth ministry")).toBe("youth-ministry");
    expect(choiceSlug("Café & Crêpes")).toBe("cafe-crepes");
    expect(choiceSlug("音楽")).toBeUndefined();
  });

  it("need choices in the collection's settings", () => {
    const settings = (options?: unknown[]) => ({
      version: 1,
      name: "News",
      entryName: "Article",
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "topics", label: "Topics", type: "tags", ...(options && { options }) },
      ],
    });
    expect(collectionFileSchema.safeParse(settings()).success).toBe(false);
    expect(collectionFileSchema.safeParse(settings([{ value: "music", label: "Music" }])).success).toBe(true);
  });
});

describe("sortEntries", () => {
  const entries = [
    entry("b", { title: "Bravo", date: "2026-01-02" }),
    entry("a", { title: "alpha", date: "2026-03-01" }),
    entry("c", { title: "Charlie" }),
    entry("d", { title: "Delta", date: "2026-01-02" }),
  ];

  it("sorts by title by default, ignoring case", () => {
    expect(sortEntries(entries).map((e) => e.slug)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by a field, with missing values last and ties by title", () => {
    expect(sortEntries(entries, "date", "desc").map((e) => e.slug)).toEqual(["a", "b", "d", "c"]);
    expect(sortEntries(entries, "date", "asc").map((e) => e.slug)).toEqual(["b", "d", "a", "c"]);
  });
});
