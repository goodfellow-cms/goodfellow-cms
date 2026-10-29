import { describe, expect, it } from "vitest";
import { isExternalLink, isScriptUrl, setLinkTargets } from "./external-links.js";

describe("isExternalLink", () => {
  it("counts addresses on other sites, not the site's own pages, files or email links", () => {
    expect(isExternalLink("https://github.com/someone")).toBe(true);
    expect(isExternalLink("http://example.com")).toBe(true);
    expect(isExternalLink("/about")).toBe(false);
    expect(isExternalLink("/media/flyer.pdf")).toBe(false);
    expect(isExternalLink("mailto:office@example.org")).toBe(false);
    expect(isExternalLink("#top")).toBe(false);
  });

  it("leaves out full addresses on the site's own address", () => {
    expect(isExternalLink("https://example.org/news", "https://example.org")).toBe(false);
    expect(isExternalLink("https://other.example/news", "https://example.org")).toBe(true);
  });
});

describe("isScriptUrl", () => {
  it("finds addresses that run code however they're spelled, as browsers read them", () => {
    for (const url of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.org/1",
      "file:///etc/passwd",
    ]) {
      expect(isScriptUrl(url), JSON.stringify(url)).toBe(true);
    }
  });

  it("leaves the site's own pages, the web's, apps' and calendars' addresses alone", () => {
    for (const url of [
      "/about",
      "#top",
      "https://example.org",
      "mailto:a@example.org",
      "tel:+15550100",
      "webcal://example.org/a.ics",
      "about",
      "?page=2",
    ]) {
      expect(isScriptUrl(url), url).toBe(false);
    }
  });
});

describe("setLinkTargets", () => {
  const html =
    '<p><a href="https://github.com">GitHub</a>, <a href="/about">About</a> and <a href="https://example.org/x">ours</a></p>';

  it("opens links to other sites in a new tab when asked, and every other link in the same tab", () => {
    expect(setLinkTargets(html, { newTab: true, siteUrl: "https://example.org" })).toBe(
      '<p><a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>, ' +
        '<a href="/about" target="_self" rel="">About</a> and <a href="https://example.org/x" target="_self" rel="">ours</a></p>',
    );
  });

  it("opens every link in the same tab otherwise", () => {
    expect(setLinkTargets(html, { newTab: false })).not.toContain("_blank");
  });

  it("decodes an address's entities once, as browsers do", () => {
    // `https:&amp;#47;&amp;#47;` is the text `https:&#47;&#47;`, not `https://`.
    expect(setLinkTargets('<a href="https:&amp;#47;&amp;#47;a.example">A</a>', { newTab: true })).toContain(
      'target="_self"',
    );
    expect(setLinkTargets('<a href="https:&#47;&#47;a.example">A</a>', { newTab: true })).toContain('target="_blank"');
  });

  it("keeps a link's own target and rel", () => {
    expect(setLinkTargets('<a href="https://a.example" target="_blank">A</a>', { newTab: false })).toBe(
      '<a href="https://a.example" target="_blank">A</a>',
    );
    expect(setLinkTargets('<a rel="nofollow" href="https://a.example">A</a>', { newTab: true })).toBe(
      '<a rel="nofollow" href="https://a.example" target="_blank">A</a>',
    );
  });
});
