import { describe, expect, it } from "vitest";
import { itemLinkRemovalChanges, moveEntryChanges } from "./changes.js";
import { checkSite } from "./checks.js";
import { cleanEntryValues, entryFieldProblems, formatFieldValue } from "./collections.js";
import { entryDetails } from "./entry-details.js";
import { changeItemLinks, collectionsLinkingTo, itemsLinkingTo, itemTitleIn, linkedItem } from "./item-links.js";
import { relinkSite } from "./links.js";
import { type ContentSource, loadSiteContent } from "./load.js";
import { collectionFileSchema } from "./schemas.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const speakers = {
  version: 1,
  name: "Speakers",
  entryName: "Speaker",
  path: "/speakers/{slug}",
  fields: [{ name: "title", label: "Name", type: "text" }],
};

const talks = {
  version: 1,
  name: "Talks",
  entryName: "Talk",
  path: "/talks/{slug}",
  fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "speakers", label: "Speakers", type: "item", collection: "speakers", multiple: true },
    { name: "host", label: "Host", type: "item", collection: "speakers" },
    { name: "featured", label: "Featured", type: "yesno" },
    { name: "photos", label: "Photos", type: "images" },
    { name: "handout", label: "Handout", type: "file" },
    {
      name: "schedule",
      label: "Schedule",
      type: "group",
      fields: [
        { name: "time", label: "Time", type: "text" },
        { name: "place", label: "Place", type: "link" },
        { name: "picture", label: "Picture", type: "image" },
      ],
    },
  ],
};

const site = (talk: Record<string, unknown>, files: Record<string, unknown> = {}) =>
  loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, title: "Parish", description: "A parish", url: "https://parish.example/" },
      "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } }, content: [] } },
      "content/pages/hall.json": { version: 1, data: { root: { props: { title: "Hall" } }, content: [] } },
      "content/collections/speakers/_collection.json": speakers,
      "content/collections/speakers/anna.json": { version: 1, fields: { title: "Anna Reyes" } },
      "content/collections/speakers/ben.json": { version: 1, fields: { title: "Ben Okafor" } },
      "content/collections/talks/_collection.json": talks,
      "content/collections/talks/advent.json": { version: 1, fields: { title: "Advent", ...talk } },
      ...files,
    }),
  );

describe("collection fields: yes or no, links to items, images, files and groups", () => {
  it("are checked as a collection's settings", () => {
    expect(collectionFileSchema.safeParse(talks).success).toBe(true);
    const noCollection = {
      ...talks,
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "a", label: "A", type: "item" },
      ],
    };
    expect(collectionFileSchema.safeParse(noCollection).success).toBe(false);
    const emptyGroup = {
      ...talks,
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "g", label: "G", type: "group", fields: [] },
      ],
    };
    expect(collectionFileSchema.safeParse(emptyGroup).success).toBe(false);
  });

  it("check items' values", () => {
    const fields = collectionFileSchema.parse(talks).fields;
    expect(
      entryFieldProblems(fields, {
        title: "Advent",
        speakers: ["anna", "ben"],
        host: "anna",
        featured: true,
        photos: ["/media/a.jpg"],
        handout: "/media/notes.pdf",
        schedule: [{ time: "9:00", place: "/hall" }],
      }),
    ).toEqual([]);
    expect(entryFieldProblems(fields, { featured: "yes" })).toHaveLength(1);
    expect(entryFieldProblems(fields, { speakers: "anna" })).toHaveLength(1);
    expect(entryFieldProblems(fields, { host: ["anna"] })).toHaveLength(1);
    expect(entryFieldProblems(fields, { photos: "/media/a.jpg" })).toHaveLength(1);
    expect(entryFieldProblems(fields, { schedule: [{ time: 9 }] })).toHaveLength(1);
  });

  it("store only what's filled in: no false, no empty rows, and only a group's own fields", () => {
    const fields = collectionFileSchema.parse(talks).fields;
    expect(
      cleanEntryValues(fields, {
        title: "Advent",
        featured: false,
        photos: [" /media/a.jpg ", ""],
        speakers: [],
        schedule: [{ time: "9:00", other: "x" }, { time: "" }, {}],
      }),
    ).toEqual({ title: "Advent", photos: ["/media/a.jpg"], schedule: [{ time: "9:00" }] });
  });

  it("show in placeholders as words", async () => {
    const content = await site({});
    const fields = new Map(collectionFileSchema.parse(talks).fields.map((field) => [field.name, field]));
    const itemTitle = itemTitleIn(content.collections);
    expect(formatFieldValue(fields.get("speakers"), ["anna", "ben"], "en", undefined, { itemTitle })).toBe(
      "Anna Reyes, Ben Okafor",
    );
    expect(formatFieldValue(fields.get("featured"), true)).toBe("Featured");
    expect(formatFieldValue(fields.get("featured"), false)).toBe("");
    expect(formatFieldValue(fields.get("schedule"), [{ time: "9:00", place: "/hall" }, { time: "10:00" }])).toBe(
      "9:00 · /hall; 10:00",
    );
  });

  it("find the items an item links to, in the language the site is shown in", async () => {
    const content = await site(
      {},
      {
        "content/site.json": {
          version: 1,
          title: "Parish",
          url: "https://parish.example/",
          languages: [{ code: "es", name: "Español" }],
        },
        "content/collections/speakers/anna-es.json": {
          version: 1,
          inLanguage: "es",
          translationOf: "anna",
          fields: { title: "Ana Reyes" },
        },
      },
    );
    const speakersCollection = content.collections.find((collection) => collection.id === "speakers");
    expect(linkedItem(speakersCollection, "anna")?.slug).toBe("anna");
    // Shown in Spanish, the site has only the Spanish items.
    const spanish = speakersCollection && {
      ...speakersCollection,
      entries: speakersCollection.entries.filter((entry) => entry.content.inLanguage === "es"),
    };
    expect(linkedItem(spanish, "anna")?.slug).toBe("anna-es");
  });

  it("are renamed with the item they link to, in the same publish", async () => {
    const content = await site({ speakers: ["anna", "ben"], host: "anna" });
    const collection = content.collections.find((candidate) => candidate.id === "speakers");
    const anna = collection?.entries.find((entry) => entry.slug === "anna");
    if (!collection || !anna) throw new Error("no speaker");
    const changes = moveEntryChanges(content, collection, anna, "anna-reyes", "/speakers/anna-reyes");
    const talk = changes.find((change) => change.path === "content/collections/talks/advent.json");
    expect(talk && "content" in talk && JSON.parse(talk.content as string).fields).toMatchObject({
      speakers: ["anna-reyes", "ben"],
      host: "anna-reyes",
    });
  });

  it("let go of an item that's deleted, and keep its collection from being deleted", async () => {
    const content = await site({ speakers: ["anna", "ben"], host: "anna" });
    const collection = content.collections.find((candidate) => candidate.id === "speakers");
    const anna = collection?.entries.find((entry) => entry.slug === "anna");
    if (!collection || !anna) throw new Error("no speaker");
    expect(itemsLinkingTo(content, "speakers", "anna").map((entry) => entry.slug)).toEqual(["advent"]);
    expect(itemsLinkingTo(content, "speakers", "ben").map((entry) => entry.slug)).toEqual(["advent"]);
    const [change] = itemLinkRemovalChanges(content, collection, anna);
    expect(change && "content" in change && JSON.parse(change.content as string).fields).toEqual({
      title: "Advent",
      speakers: ["ben"],
    });
    expect(collectionsLinkingTo(content, "speakers").map((other) => other.id)).toEqual(["talks"]);
    expect(collectionsLinkingTo(content, "talks")).toEqual([]);
    expect(changeItemLinks(content, "speakers", (slug) => slug)).toEqual({ content, files: [] });
  });

  it("are checked with the site: links to items, images and files that aren't there", async () => {
    const content = await site({
      speakers: ["anna", "carla"],
      photos: ["/media/a.jpg", "/media/gone.jpg"],
      handout: "/media/notes.pdf",
      schedule: [{ time: "9:00", place: "/nowhere", picture: "/media/also-gone.jpg" }],
    });
    const errors = checkSite(content, { media: ["/media/a.jpg", "/media/notes.pdf"] })
      .filter((problem) => problem.severity === "error")
      .map((problem) => [problem.kind, "target" in problem ? problem.target : ""]);
    expect(errors).toEqual(
      expect.arrayContaining([
        ["missing-media", "/media/gone.jpg"],
        ["missing-page", "/nowhere"],
        ["missing-media", "/media/also-gone.jpg"],
        ["missing-item", "carla"],
      ]),
    );
    expect(errors).toHaveLength(4);
  });

  it("follow a page that moves, in a group's links", async () => {
    const content = await site({ schedule: [{ time: "9:00", place: "/hall#door" }] });
    const relinked = relinkSite(content, [{ from: "/hall", to: "/parish-hall" }]);
    const talk = relinked.content.collections
      .find((collection) => collection.id === "talks")
      ?.entries.find((entry) => entry.slug === "advent");
    expect(talk?.content.fields.schedule).toEqual([{ time: "9:00", place: "/parish-hall#door" }]);
    expect(relinked.files).toContain("content/collections/talks/advent.json");
  });

  it("give feeds and structured data a picture from several images", async () => {
    const content = await site({ photos: ["/media/a.jpg", "/media/b.jpg"] });
    const collection = content.collections.find((candidate) => candidate.id === "talks");
    const talk = collection?.entries[0];
    if (!collection || !talk) throw new Error("no talk");
    expect(entryDetails(collection, talk).image).toBe("/media/a.jpg");
  });
});
