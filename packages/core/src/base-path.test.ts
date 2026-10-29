import { describe, expect, it } from "vitest";
import { applyBasePath, normalizeBase, withBase } from "./base-path.js";

describe("normalizeBase", () => {
  it.each([
    [undefined, "/"],
    ["", "/"],
    ["/", "/"],
    ["repo", "/repo/"],
    ["/repo", "/repo/"],
    ["/a/b/", "/a/b/"],
  ])("%s → %s", (input, output) => {
    expect(normalizeBase(input)).toBe(output);
  });
});

describe("applyBasePath", () => {
  it("prefixes root-relative links, images and srcsets", () => {
    const html =
      '<a href="/about">a</a><img src="/media/x.png" srcset="/media/x.png 1x, /media/x2.png 2x"/>' +
      '<link rel="stylesheet" href="/assets/s.css"/><video poster="/media/p.jpg"></video>';
    expect(applyBasePath(html, "/repo/")).toBe(
      '<a href="/repo/about">a</a><img src="/repo/media/x.png" srcset="/repo/media/x.png 1x, /repo/media/x2.png 2x"/>' +
        '<link rel="stylesheet" href="/repo/assets/s.css"/><video poster="/repo/media/p.jpg"></video>',
    );
  });

  it("prefixes srcsets as React spells them, and preloads' image srcsets", () => {
    expect(
      applyBasePath(
        '<link rel="preload" as="image" imageSrcSet="/media-sizes/480/x.jpg 480w, /media/x.jpg 900w"/>' +
          '<img src="/media/x.jpg" srcSet="/media-sizes/480/x.jpg 480w, /media/x.jpg 900w"/>',
        "/repo/",
      ),
    ).toBe(
      '<link rel="preload" as="image" imageSrcSet="/repo/media-sizes/480/x.jpg 480w, /repo/media/x.jpg 900w"/>' +
        '<img src="/repo/media/x.jpg" srcSet="/repo/media-sizes/480/x.jpg 480w, /repo/media/x.jpg 900w"/>',
    );
  });

  it("prefixes url() in style attributes", () => {
    expect(applyBasePath('<section style="background-image:url(&quot;/media/bg.jpg&quot;)">', "/repo/")).toBe(
      '<section style="background-image:url(&quot;/repo/media/bg.jpg&quot;)">',
    );
  });

  it("leaves absolute, protocol-relative, fragment and text URLs alone", () => {
    const html =
      '<a href="https://example.org/x">a</a><a href="//cdn.example.org/x">b</a><a href="#top">c</a>' +
      '<meta property="og:url" content="/about"/><p>href="/not-an-attribute"</p>';
    expect(applyBasePath(html, "/repo/")).toBe(html);
  });

  it("does nothing for the root base", () => {
    expect(applyBasePath('<a href="/about">', "/")).toBe('<a href="/about">');
  });
});

describe("withBase", () => {
  it("prefixes root-relative addresses only", () => {
    expect(withBase("/about", "/repo/")).toBe("/repo/about");
    expect(withBase("/", "/repo/")).toBe("/repo/");
    expect(withBase("https://example.org/x", "/repo/")).toBe("https://example.org/x");
    expect(withBase("//cdn.example.org/x", "/repo/")).toBe("//cdn.example.org/x");
    expect(withBase("#top", "/repo/")).toBe("#top");
    expect(withBase("/about", undefined)).toBe("/about");
  });
});
