import { createPuckConfig, templateOnly, withKeywords } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { searchableBlocks, searchBlocks } from "./block-search.js";

const block = (label: string, keywords: string[] = []): ComponentConfig =>
  withKeywords({ label, fields: {}, render: () => <div /> } as ComponentConfig, keywords);

const config = {
  blocks: {
    Section: block("Section", ["cover", "group"]),
    Grid: block("Grid", ["columns"]),
    Separator: block("Separator", ["divider", "line"]),
    Heading: block("Heading", ["title"]),
    Table: block("Table", ["columns"]),
    Image: block("Image", ["picture", "photo"]),
    Gallery: block("Gallery", ["pictures"]),
    MediaText: block("Media & text", ["media and text"]),
    ContactDetails: block("Contact details"),
    Menu: block("Menu"),
    EntryField: templateOnly(block("Item field")),
    Mine: block("A block of the site's own"),
  },
  categories: {
    layout: { title: "Layout", components: ["Section", "Grid", "Separator", "MediaText"] },
    content: { title: "Text", components: ["Heading", "Table"] },
    media: { title: "Media", components: ["Image", "Gallery"] },
    navigation: { title: "Navigation", components: ["Menu"] },
    collections: { title: "Collections", components: ["EntryField"] },
  },
};
const page = searchableBlocks(createPuckConfig(config, "page"), config);
const names = (query: string) => searchBlocks(query, page).map((found) => found.name);

describe("searching the block list", () => {
  it("lists the editor's blocks in the list's order, each in its group, and the rest after them", () => {
    expect(page.map((found) => found.name)).toEqual([
      "Section",
      "Grid",
      "Separator",
      "MediaText",
      "Heading",
      "Table",
      "Image",
      "Gallery",
      "Menu",
      "ContactDetails",
      "Mine",
    ]);
    expect(page.find((found) => found.name === "Heading")?.group).toBe("Text");
    expect(page.find((found) => found.name === "Mine")?.group).toBeUndefined();
  });

  it("finds blocks by their labels first", () => {
    expect(names("head")[0]).toBe("Heading");
    expect(names("Gallery")).toEqual(["Gallery"]);
  });

  it("finds blocks by other words for them", () => {
    expect(names("cover")).toEqual(["Section"]);
    expect(names("columns")).toEqual(["Grid", "Table"]);
    expect(names("divider")).toEqual(["Separator"]);
    expect(names("media and text")).toEqual(["MediaText"]);
  });

  it("finds a block by its name's words and by its group", () => {
    expect(names("contact details")).toEqual(["ContactDetails"]);
    expect(names("navigation")).toEqual(["Menu"]);
  });

  it("needs every word typed, at the start of a word", () => {
    expect(names("pic")).toEqual(["Image", "Gallery"]);
    expect(names("icture")).toEqual([]);
    expect(names("grid zzz")).toEqual([]);
  });

  it("lists everything while nothing's typed", () => {
    expect(searchBlocks("  ", page)).toHaveLength(page.length);
  });
});
