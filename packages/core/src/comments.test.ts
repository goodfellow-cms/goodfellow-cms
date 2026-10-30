import { describe, expect, it } from "vitest";
import { disqusEmbedUrl, disqusShortname, garrulAddress, garrulSlug } from "./comments.js";
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

  it("can be Disqus's site, by its shortname", () => {
    expect(siteSettingsSchema.parse({ version: 1, comments: { disqus: "stjoseph" } }).comments).toEqual({
      disqus: "stjoseph",
    });
    for (const disqus of ["", "St Joseph", "stjoseph.disqus.com", '"><script>', "-stjoseph"]) {
      expect(siteSettingsSchema.safeParse({ version: 1, comments: { disqus } }).success, disqus).toBe(false);
    }
  });
});

describe("Disqus's shortname", () => {
  it("is read from Disqus's code, its addresses or the shortname itself", () => {
    const code = `<div id="disqus_thread"></div>
<script>
    (function() { // DON'T EDIT BELOW THIS LINE
    var d = document, s = d.createElement('script');
    s.src = 'https://st-joseph.disqus.com/embed.js';
    s.setAttribute('data-timestamp', +new Date());
    (d.head || d.body).appendChild(s);
    })();
</script>`;
    expect(disqusShortname(code)).toBe("st-joseph");
    expect(disqusShortname("https://stjoseph.disqus.com/admin/settings/general/")).toBe("stjoseph");
    expect(disqusShortname("stjoseph.disqus.com")).toBe("stjoseph");
    expect(disqusShortname("  StJoseph ")).toBe("stjoseph");
    expect(disqusEmbedUrl("stjoseph")).toBe("https://stjoseph.disqus.com/embed.js");
  });

  it("is nothing where there's none to read", () => {
    for (const text of [
      "",
      "<p>Hi</p>",
      "St Joseph",
      "https://disqus.com/",
      "https://www.disqus.com/",
      "a.disqus.com.example",
    ]) {
      expect(disqusShortname(text), text).toBeUndefined();
    }
  });
});

describe("Garrul's address", () => {
  it("is its Worker's origin, read from its address or the code Garrul gives", () => {
    const code = `<div id="garrul" data-slug="my-post-slug" data-api="https://comments.example.org" data-title="My post"></div>
<script src="https://comments.example.org/embed.js" defer></script>`;
    expect(garrulAddress(code)).toBe("https://comments.example.org");
    expect(garrulAddress('<div id="garrul"></div><script src="https://c.example.org/embed.js" defer></script>')).toBe(
      "https://c.example.org",
    );
    expect(garrulAddress("https://comments.example.org/admin/")).toBe("https://comments.example.org");
    expect(garrulAddress("http://localhost:8787")).toBe("http://localhost:8787");
    for (const text of [
      "",
      "comments.example.org",
      "http://comments.example.org",
      "javascript:alert(1)",
      "https://user:pass@comments.example.org",
      "<script src='https://stjoseph.disqus.com/embed.js'></script>",
      "<p>Hi</p>",
    ]) {
      expect(garrulAddress(text), text).toBeUndefined();
    }
  });

  it("is kept in Site settings only as an origin", () => {
    expect(
      siteSettingsSchema.parse({ version: 1, comments: { garrul: "https://comments.example.org" } }).comments,
    ).toEqual({ garrul: "https://comments.example.org" });
    for (const garrul of ["https://comments.example.org/", "http://comments.example.org", '"><script>']) {
      expect(siteSettingsSchema.safeParse({ version: 1, comments: { garrul } }).success, garrul).toBe(false);
    }
  });

  it("names a page's comments by its address, in the letters Garrul allows", () => {
    expect(garrulSlug("/news/parish-fair")).toBe("/news/parish-fair");
    expect(garrulSlug("/es/noticias/año nuevo")).toBe("/es/noticias/a-o-nuevo");
    expect(garrulSlug(`/${"a".repeat(300)}`)).toHaveLength(200);
  });
});
