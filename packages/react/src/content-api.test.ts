import {
  type Collection,
  collectionFileSchema,
  type Page,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { prepareContentApi } from "./content-api.js";

const settings = siteSettingsSchema.parse({ version: 1, title: "Northwind", url: "https://northwind.example" });

function page(path: string, props: Record<string, unknown>, entry?: Page["entry"]): Page {
  return {
    path,
    file: `content/pages${path === "/" ? "/index" : path}.json`,
    content: { version: 1, data: { root: { props }, content: [] } },
    ...(entry && { entry }),
  };
}

function collection(id: string, visibility?: "members"): Collection {
  return {
    id,
    file: `content/collections/${id}/_collection.json`,
    settings: collectionFileSchema.parse({
      version: 1,
      name: id,
      entryName: id,
      path: `/${id}/{slug}`,
      fields: [{ name: "title", label: "Title", type: "text" }],
      ...(visibility && { visibility }),
    }),
    entries: [
      {
        collection: id,
        slug: "first",
        file: `content/collections/${id}/first.json`,
        path: `/${id}/first`,
        content: { version: 1, fields: { title: `First ${id}` } },
      },
    ],
  };
}

describe("prepareContentApi", () => {
  it("leaves out members' pages and collections, since anyone can read it", async () => {
    const home = page("/", { title: "Home" });
    const handbook = page("/handbook", { title: "Handbook", visibility: "members" });
    const memo = page("/memos/first", {}, { collection: "memos", slug: "first" });
    const content: SiteContent = {
      settings,
      menus: {},
      header: { version: 1, data: { root: {}, content: [] } },
      footer: { version: 1, data: { root: {}, content: [] } },
      pages: [home, handbook],
      collections: [collection("news"), collection("memos", "members")],
      customCss: "",
    };
    const input = await prepareContentApi({ blocks: {} }, content, [home, handbook, memo]);
    expect(input.pages.map((prepared) => prepared.page.path)).toEqual(["/"]);
    expect(input.content.collections.map((shown) => shown.id)).toEqual(["news"]);
    expect(input.content.pages.map((shown) => shown.path)).toEqual(["/"]);
  });
});
