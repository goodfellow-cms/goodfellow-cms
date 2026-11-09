import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPDATE_FILES } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { NEXT_SITE_FILES, nextSiteFiles } from "./site-files.js";

const STARTER = join(import.meta.dirname, "../../../templates/next");

describe("NEXT_SITE_FILES", () => {
  it("are the Next.js starter's files as it has them now", () => {
    for (const file of NEXT_SITE_FILES) {
      expect(readFileSync(join(STARTER, file.path), "utf8"), file.path).toBe(file.content);
    }
  });

  it("are files the nightly update's publish job lets an update change", () => {
    for (const file of NEXT_SITE_FILES) expect(UPDATE_FILES, file.path).toContain(file.path);
  });
});

describe("nextSiteFiles", () => {
  const paths = (files: readonly { path: string }[]) => files.map((file) => file.path);

  it("keeps every starter file on a site whose admin page is the starter's, now or before the frames", () => {
    const admin = NEXT_SITE_FILES.find((file) => file.path === "app/admin/page.tsx");
    expect(nextSiteFiles(admin?.content)).toBe(NEXT_SITE_FILES);
    expect(nextSiteFiles(admin?.earlier[0]?.replace(/\n/g, "\r\n"))).toBe(NEXT_SITE_FILES);
  });

  it("adds no editor page where the site has an admin page of its own, as a full-stack site does", () => {
    const fullStack = readFileSync(join(import.meta.dirname, "../../../examples/company/app/admin/page.tsx"), "utf8");
    expect(paths(nextSiteFiles(fullStack))).not.toContain("app/admin/editor/page.tsx");
    expect(paths(nextSiteFiles(fullStack))).toContain("vercel.json");
  });

  it("keeps nothing up to date on a site without an admin panel", () => {
    expect(nextSiteFiles(undefined)).toEqual([]);
  });
});
