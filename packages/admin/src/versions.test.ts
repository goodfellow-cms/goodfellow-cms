import { ContentError, type ContentSource, HEADER_FILE, loadSiteContent } from "@goodfellow-cms/core";
import type { Config } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import {
  contentWithVersion,
  previewPage,
  restoreChange,
  subjectTitle,
  unknownBlocks,
  versionSubject,
} from "./versions.js";

const page = (title: string, content: unknown[] = []) =>
  JSON.stringify({ version: 1, data: { root: { props: { title } }, content } });

const FILES: Record<string, string> = {
  "content/pages/index.json": page("Home"),
  "content/pages/about.json": page("About us"),
  "content/header.json": JSON.stringify({ version: 1, data: { root: {}, content: [] } }),
  "content/collections/news/_collection.json": JSON.stringify({
    version: 1,
    name: "News",
    entryName: "Story",
    path: "/news/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "summary", label: "Summary", type: "text" },
    ],
    template: { root: {}, content: [] },
  }),
  "content/collections/news/fair.json": JSON.stringify({ version: 1, fields: { title: "Parish fair" } }),
};

const source: ContentSource = {
  read: async (path) => FILES[path],
  list: async (dir) => Object.keys(FILES).filter((path) => path.startsWith(`${dir}/`)),
};

describe("versionSubject", () => {
  it("finds the page, layout part, or item a file is", async () => {
    const content = await loadSiteContent(source);
    const about = versionSubject(content, "content/pages/about.json");
    expect(about?.kind).toBe("page");
    expect(about && subjectTitle(about)).toBe("About us");
    expect(versionSubject(content, HEADER_FILE)).toEqual({ kind: "header", file: HEADER_FILE });
    const fair = versionSubject(content, "content/collections/news/fair.json");
    expect(fair?.kind).toBe("entry");
    expect(fair && subjectTitle(fair)).toBe("Parish fair");
    expect(versionSubject(content, "content/site.json")).toBeUndefined();
  });
});

describe("restoring a version", () => {
  it("loads the site with the version put back, and writes it in canonical form", async () => {
    const file = "content/pages/about.json";
    const content = await contentWithVersion(source, file, page("Who we are"));
    const subject = versionSubject(content, file);
    if (!subject) throw new Error("No subject");
    expect(subjectTitle(subject)).toBe("Who we are");
    expect(previewPage(content, subject)?.path).toBe("/about");
    const change = restoreChange(content, subject);
    expect(change.path).toBe(file);
    const text = "content" in change ? change.content : "";
    expect(JSON.parse(text).data.root.props.title).toBe("Who we are");
    expect(text).toMatch(/^\{\n {2}"version": 1,[\s\S]*\n\}\n$/);
  });

  it("shows an item on its page, and the header on the home page", async () => {
    const item = "content/collections/news/fair.json";
    const content = await contentWithVersion(
      source,
      item,
      JSON.stringify({ version: 1, fields: { title: "Summer fair", summary: "Games" } }),
    );
    const subject = versionSubject(content, item);
    if (!subject) throw new Error("No subject");
    expect(previewPage(content, subject)?.path).toBe("/news/fair");
    expect(restoreChange(content, subject).path).toBe(item);
    // A field removed since then isn't put back.
    const old = await contentWithVersion(
      source,
      item,
      JSON.stringify({ version: 1, fields: { title: "Fair", removed: "Gone" } }),
    );
    const oldSubject = versionSubject(old, item);
    const change = oldSubject && restoreChange(old, oldSubject);
    expect(change && "content" in change ? JSON.parse(change.content).fields : undefined).toEqual({ title: "Fair" });
    const header = versionSubject(content, HEADER_FILE);
    expect(header && previewPage(content, header)?.path).toBe("/");
  });

  it("refuses a version that no longer fits the site", async () => {
    await expect(
      contentWithVersion(
        source,
        "content/collections/news/fair.json",
        JSON.stringify({ version: 1, fields: { title: "Fair", summary: 5 } }),
      ),
    ).rejects.toBeInstanceOf(ContentError);
  });
});

describe("restoring a version on a site with a sourced collection", () => {
  it("leaves out the item files left in its folder, which its source's items replace", async () => {
    // A file left in the folder that loading would refuse, written before the collection's fields changed.
    const left: ContentSource = {
      read: (path) =>
        path === "content/collections/news/old.json"
          ? Promise.resolve(JSON.stringify({ version: 1, fields: { title: "Old", summary: 5 } }))
          : source.read(path),
      list: async (dir) => [
        ...(await source.list(dir)),
        ...("content/collections/news/old.json".startsWith(`${dir}/`) ? ["content/collections/news/old.json"] : []),
      ],
    };
    const about = "content/pages/about.json";
    await expect(contentWithVersion(left, about, page("Who we are"))).rejects.toBeInstanceOf(ContentError);
    const content = await contentWithVersion(left, about, page("Who we are"), ["news"]);
    expect(content.collections.find((one) => one.id === "news")?.entries).toEqual([]);
    expect(versionSubject(content, about)).toBeDefined();
  });
});

describe("unknownBlocks", () => {
  it("names blocks the site doesn't have, including inside other blocks", () => {
    const config = { components: { Heading: {}, Section: {} } } as unknown as Config;
    const data = {
      root: { props: {} },
      content: [
        { type: "Heading", props: { id: "a" } },
        { type: "Section", props: { id: "b", content: [{ type: "Gallery", props: { id: "c" } }] } },
        { type: "OldBanner", props: { id: "d" } },
      ],
    };
    expect(unknownBlocks(data, config)).toEqual(["Gallery", "OldBanner"]);
    expect(unknownBlocks({ root: { props: {} }, content: [] }, config)).toEqual([]);
  });
});
