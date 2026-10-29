import { describe, expect, it } from "vitest";
import { siteSettingsSchema } from "./content/schemas.js";

describe("where comments are kept", () => {
  const comments = {
    repo: "stjoseph/comments",
    repoId: "R_kgDOabc123",
    category: "Announcements",
    categoryId: "DIC_kw1",
  };

  it("is read from Site settings, and left out where there's none", () => {
    expect(siteSettingsSchema.parse({ version: 1, comments }).comments).toEqual(comments);
    expect(siteSettingsSchema.parse({ version: 1 }).comments).toBeUndefined();
  });

  it("refuses values Giscus's settings couldn't hold", () => {
    for (const wrong of [
      { ...comments, repo: "stjoseph" },
      { ...comments, repo: 'stjoseph/comments" onload="x' },
      { ...comments, repoId: "R_<script>" },
      { ...comments, categoryId: "" },
    ]) {
      expect(siteSettingsSchema.safeParse({ version: 1, comments: wrong }).success, JSON.stringify(wrong)).toBe(false);
    }
  });
});
