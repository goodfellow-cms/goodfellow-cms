import { describe, expect, it } from "vitest";
import type { AdminSite } from "./admin-site.js";
import { adminSiteForCopy, isSiteCopy, siteCopyFrom, withSiteCopy } from "./site-copy.js";

describe("siteCopyFrom", () => {
  it("is nothing for the main site", () => {
    expect(siteCopyFrom({})).toEqual({});
    expect(isSiteCopy(siteCopyFrom({ GOODFELLOW_SITE_URL: " ", GOODFELLOW_NO_INDEX: "false" }))).toBe(false);
  });

  it("reads a copy's address and search engine setting", () => {
    expect(siteCopyFrom({ GOODFELLOW_SITE_URL: "https://staging.example.org/", GOODFELLOW_NO_INDEX: "1" })).toEqual({
      url: "https://staging.example.org",
      noIndex: true,
    });
    expect(siteCopyFrom({ GOODFELLOW_NO_INDEX: "Yes" })).toEqual({ noIndex: true });
    expect(siteCopyFrom({ GOODFELLOW_SITE_URL: "https://example.org/staging" })).toEqual({
      url: "https://example.org/staging",
    });
  });

  it("refuses values it can't use, saying which", () => {
    expect(() => siteCopyFrom({ GOODFELLOW_SITE_URL: "staging.example.org" })).toThrow(/GOODFELLOW_SITE_URL/);
    expect(() => siteCopyFrom({ GOODFELLOW_SITE_URL: "ftp://example.org" })).toThrow(/web address/);
    expect(() => siteCopyFrom({ GOODFELLOW_NO_INDEX: "maybe" })).toThrow(/GOODFELLOW_NO_INDEX/);
  });
});

describe("withSiteCopy", () => {
  const text = '{\n  "version": 1,\n  "title": "St. Joseph",\n  "url": "https://example.org"\n}\n';

  it("puts the copy's address and setting in place of the file's", () => {
    expect(JSON.parse(withSiteCopy(text, { url: "https://staging.example.org", noIndex: true }))).toEqual({
      version: 1,
      title: "St. Joseph",
      url: "https://staging.example.org",
      noIndex: true,
    });
    expect(JSON.parse(withSiteCopy(text, { noIndex: true })).url).toBe("https://example.org");
  });

  it("leaves the file as it is for the main site, or when it can't be read", () => {
    expect(withSiteCopy(text, {})).toBe(text);
    expect(withSiteCopy("{", { noIndex: true })).toBe("{");
    expect(withSiteCopy("[]", { noIndex: true })).toBe("[]");
  });
});

describe("adminSiteForCopy", () => {
  const admin = { url: "https://admin.example.org", checked: true };
  const site: AdminSite = {
    description: { version: 1, goodfellow: "1.0.0", contentVersions: {}, blocks: {}, admin },
    admin,
  } as unknown as AdminSite;

  it("leaves out the main site's admin address on a copy at an address of its own", () => {
    const copy = { url: "https://staging.example.org", noIndex: true };
    const built = adminSiteForCopy(site, copy);
    expect(built.admin).toBeUndefined();
    expect(built.description.admin).toBeUndefined();
    expect(built.copy).toEqual(copy);
  });

  it("changes nothing for the main site", () => {
    expect(adminSiteForCopy(site, {})).toBe(site);
    expect(adminSiteForCopy(site, { noIndex: true }).admin).toEqual(admin);
  });
});
