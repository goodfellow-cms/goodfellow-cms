import { describe, expect, it } from "vitest";
import { excerptHtml, isSearchFile, SEARCH_RESULTS, type SearchFile, searchTerm, siteSearch } from "./site-search.js";

const file: SearchFile = {
  version: 1,
  language: "en",
  documents: [
    { path: "/", title: "Welcome", text: "Everything in one place. Build pages from blocks." },
    { path: "/about/", title: "About us", text: "We are a small parish café, open every Sunday after Mass." },
    { path: "/news/fair/", title: "Summer fair", text: "The summer fair raises money for the roof. Bring cakes." },
    { path: "/news/roof/", title: "The roof", text: "Publishing the roof's accounts: the fair paid for half." },
  ],
};

describe("siteSearch", () => {
  const search = siteSearch(file);

  it("finds pages by any word of their text, not only their titles", () => {
    expect(search.search("everything").map((result) => result.path)).toEqual(["/"]);
    expect(search.search("cakes").map((result) => result.path)).toEqual(["/news/fair/"]);
  });

  it("finds only pages with every word typed, the last a word's beginning", () => {
    expect(
      search
        .search("fair roof")
        .map((result) => result.path)
        .sort(),
    ).toEqual(["/news/fair/", "/news/roof/"]);
    expect(search.search("fair cak").map((result) => result.path)).toEqual(["/news/fair/"]);
    expect(search.search("fair sunday")).toEqual([]);
  });

  it("puts pages whose title has the word first", () => {
    expect(search.search("roof")[0]?.path).toBe("/news/roof/");
  });

  it("finds words whatever their case and accents", () => {
    expect(search.search("CAFE").map((result) => result.path)).toEqual(["/about/"]);
    expect(searchTerm("Café")).toBe("cafe");
  });

  it("allows a typo in long words, never in short ones", () => {
    expect(search.search("publishimg").map((result) => result.path)).toEqual(["/news/roof/"]);
    expect(search.search("mas").map((result) => result.path)).toEqual(["/about/"]);
    expect(search.search("caks")).toEqual([]);
  });

  it("finds nothing for nothing", () => {
    expect(search.search("")).toEqual([]);
    expect(search.search("  ... ")).toEqual([]);
  });

  it("gives at most SEARCH_RESULTS pages", () => {
    const many: SearchFile = {
      ...file,
      documents: Array.from({ length: 20 }, (_, n) => ({
        path: `/p${n}/`,
        title: `Page ${n}`,
        text: "the same words",
      })),
    };
    expect(siteSearch(many).search("same")).toHaveLength(SEARCH_RESULTS);
  });

  it("gives an excerpt around the first match, with the words matched marked", () => {
    const [result] = search.search("cakes");
    expect(result?.excerpt).toEqual([
      { text: "fair raises money for the roof. Bring " },
      { text: "cakes", match: true },
      { text: "." },
    ]);
    const long: SearchFile = {
      ...file,
      documents: [{ path: "/long/", title: "Long", text: `${"word ".repeat(100)}needle ${"after ".repeat(100)}` }],
    };
    const parts = siteSearch(long).search("needle")[0]?.excerpt ?? [];
    const words = parts
      .map((part) => part.text)
      .join("")
      .trim()
      .split(/\s+/);
    expect(words).toHaveLength(30);
    expect(words.indexOf("needle")).toBe(7);
    expect(parts.filter((part) => part.match)).toEqual([{ text: "needle", match: true }]);
  });

  it("gives the start of the text where only the title matched", () => {
    expect(search.search("welcome")[0]?.excerpt).toEqual([
      { text: "Everything in one place. Build pages from blocks." },
    ]);
  });
});

describe("excerptHtml", () => {
  it("escapes the text and marks the matches, as Pagefind's excerpts are", () => {
    expect(excerptHtml([{ text: "a <b> & " }, { text: "<i>", match: true }])).toBe(
      "a &lt;b&gt; &amp; <mark>&lt;i&gt;</mark>",
    );
  });
});

describe("isSearchFile", () => {
  it("takes only files of this version, with documents of strings", () => {
    expect(isSearchFile(file)).toBe(true);
    expect(isSearchFile({ ...file, version: 2 })).toBe(false);
    expect(isSearchFile({ ...file, documents: [{ path: "/", title: 1, text: "" }] })).toBe(false);
    expect(isSearchFile({ ...file, documents: [null] })).toBe(false);
    expect(isSearchFile(null)).toBe(false);
  });
});
