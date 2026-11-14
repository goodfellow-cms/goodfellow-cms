import { describe, expect, it } from "vitest";
import {
  InvalidPathError,
  isReservedPagePath,
  matchesAddressPattern,
  normalizePagePath,
  pageFileToPath,
  pageOutputFile,
  pagePathToFile,
  unreservedPagePath,
} from "./paths.js";

describe("page paths", () => {
  it.each([
    ["/", "content/pages/index.json"],
    ["/about", "content/pages/about.json"],
    ["/about/our-team", "content/pages/about/our-team.json"],
  ])("maps %s to %s and back", (path, file) => {
    expect(pagePathToFile(path)).toBe(file);
    expect(pageFileToPath(file)).toBe(path);
  });

  it("serves a folder's index.json at the folder's address", () => {
    expect(pageFileToPath("content/pages/news/index.json")).toBe("/news");
  });

  it("normalizes trailing and repeated slashes", () => {
    expect(normalizePagePath("/about/")).toBe("/about");
    expect(normalizePagePath("//about//team")).toBe("/about/team");
  });

  it.each(["about", "/About", "/my_page", "/a--b", "/-a", "/a b", "/../secret"])("rejects %s", (path) => {
    expect(() => pagePathToFile(path)).toThrow(InvalidPathError);
  });

  // An address ending in "index" would be stored in the file of the page above it, and replace that page.
  it.each(["/index", "/news/index"])("refuses %s, whose file is another page's", (path) => {
    expect(() => pagePathToFile(path)).toThrow(InvalidPathError);
    expect(isReservedPagePath(path)).toBe(true);
  });

  it("gives imports an address a page can have for one that's reserved", () => {
    expect(unreservedPagePath("/docs/index")).toBe("/docs/index-page");
    expect(unreservedPagePath("/index")).toBe("/index-page");
    expect(unreservedPagePath("/admin/help")).toBe("/admin-page/help");
    for (const path of ["/docs/index", "/index", "/admin/help", "/admin/index"]) {
      expect(isReservedPagePath(unreservedPagePath(path)), path).toBe(false);
      expect(() => pagePathToFile(unreservedPagePath(path))).not.toThrow();
    }
  });

  it("keeps addresses that only have index in them", () => {
    expect(isReservedPagePath("/index/about")).toBe(false);
    expect(isReservedPagePath("/indexes")).toBe(false);
    expect(pagePathToFile("/index/about")).toBe("content/pages/index/about.json");
  });

  it("rejects files outside the pages folder", () => {
    expect(() => pageFileToPath("content/site.json")).toThrow(InvalidPathError);
    expect(() => pageFileToPath("content/pages/notes.txt")).toThrow(InvalidPathError);
  });

  it.each([
    ["/", "index.html"],
    ["/about", "about/index.html"],
    ["/about/team", "about/team/index.html"],
    ["/404", "404.html"],
    ["/news/404", "news/404/index.html"],
  ])("builds %s to %s", (path, output) => {
    expect(pageOutputFile(path)).toBe(output);
  });
});

describe("matchesAddressPattern", () => {
  it("says whether an address is one an item of a collection with the pattern could have", () => {
    expect(matchesAddressPattern("/videos/{slug}", "/videos/easter-vigil")).toBe(true);
    expect(matchesAddressPattern("/events/{slug}/details", "/events/fair/details")).toBe(true);
    expect(matchesAddressPattern("/{slug}", "/fair")).toBe(true);
    expect(matchesAddressPattern("/videos/{slug}", "/videos/easter-vigil/more")).toBe(false);
    expect(matchesAddressPattern("/videos/{slug}", "/videos")).toBe(false);
    expect(matchesAddressPattern("/videos/{slug}", "/films/easter-vigil")).toBe(false);
    expect(matchesAddressPattern("/videos/{slug}", "/videos/Not A Name")).toBe(false);
    expect(matchesAddressPattern("/events/{slug}/details", "/events/fair/more")).toBe(false);
  });
});
