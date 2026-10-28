// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createMediaPreviews, showMediaInPreview } from "./media-previews.js";

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("showMediaInPreview", () => {
  const storage = {
    url: "https://media.example.org/site",
    files: { "/media/kept.jpg": { size: 1 } },
  };
  const previews = () =>
    createMediaPreviews({ readBytes: async () => undefined }, "/goodfellow-demo/", () => storage as never);

  it("shows media from the site's folder, from memory and from storage, as the preview changes", async () => {
    const shown = previews();
    shown.remember("/media/new.png", new Uint8Array([1]));
    document.body.innerHTML = '<img src="/media/church.svg">';
    const stop = showMediaInPreview(document, shown);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a href="/media/new.png">New</a><div style="background: url(/media/kept.jpg)"></div>',
    );
    await settled();
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/goodfellow-demo/media/church.svg");
    expect(document.querySelector("img")?.getAttribute("data-gf-src")).toBe("/media/church.svg");
    expect(document.querySelector("a")?.getAttribute("href")).toMatch(/^blob:/);
    expect(document.querySelector("div")?.getAttribute("style")).toContain(
      "url(https://media.example.org/site/kept.jpg)",
    );
    stop();
  });

  it("leaves what's inside `keep` as it is, so text edited in place keeps content's addresses", async () => {
    document.body.innerHTML = "";
    const stop = showMediaInPreview(document, previews(), { keep: "[contenteditable]" });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p contenteditable="true"><a href="/media/file.pdf">A file</a></p><img src="/media/church.svg">',
    );
    await settled();
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/media/file.pdf");
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/goodfellow-demo/media/church.svg");
    stop();
  });
});
