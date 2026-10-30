import { describe, expect, it } from "vitest";
import { isCleanSvg, unsafeMediaChanges } from "./svg-check.js";

const svg = (body: string, attributes = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attributes}>${body}</svg>`;

describe("whether an SVG is clean", () => {
  it("is true of what the admin panel's cleaning leaves", () => {
    expect(
      isCleanSvg(svg('<rect width="4" height="4" fill="url(#g)"/><a href="https://example.org"><text>Hi</text></a>')),
    ).toBe(true);
    expect(isCleanSvg(`<?xml version="1.0"?>\n${svg('<use xlink:href="#icon"/><image href="/media/a.png"/>')}\n`)).toBe(
      true,
    );
    expect(isCleanSvg(svg("<style><![CDATA[.a{fill:red}]]></style><g/>"))).toBe(true);
  });

  it("is false of anything that could run code or load from another site", () => {
    for (const body of [
      "<script>alert(1)</script>",
      '<rect onload="alert(1)"/>',
      '<a href="javascript:alert(1)"><text>x</text></a>',
      '<a href="&#106;avascript:alert(1)"><text>x</text></a>',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
      '<g xmlns="http://www.w3.org/1999/xhtml"><script>x</script></g>',
      '<html:script xmlns:html="http://www.w3.org/1999/xhtml">x</html:script>',
      '<use href="https://tracker.example/a.svg#x"/>',
      '<use href="/\\tracker.example/a.svg#x"/>',
      '<rect fill="URL(https://tracker.example/b.svg#p)"/>',
      '<style>@import "https://tracker.example/c.css";</style>',
      "<style>.a{background:\\75 rl(https://tracker.example/d.png)}</style>",
      '<animate attributeName="href" to="javascript:alert(1)"/>',
      "<!-- a comment -->",
      '<?xml-stylesheet href="https://evil.example/x.xsl"?>',
    ]) {
      expect(isCleanSvg(svg(body)), body).toBe(false);
    }
    expect(isCleanSvg(`<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]>${svg("<text>&x;</text>")}`)).toBe(
      false,
    );
    expect(isCleanSvg('<?xml-stylesheet href="x.xsl"?><svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
    expect(isCleanSvg("<svg><rect/></svg>")).toBe(false);
    expect(isCleanSvg('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toBe(false);
    expect(isCleanSvg(`${svg("<g/>")}${svg("<g/>")}`)).toBe(false);
  });
});

describe("media changes a server refuses", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  it("are files the site can't use by the name they're saved under, and SVGs that aren't clean", () => {
    expect(
      unsafeMediaChanges([
        { path: "public/media/page.html", bytes: bytes("<script>x</script>") },
        { path: "public/media/a.Svg", content: svg("<script>x</script>") },
        { path: "public/media/b.svg", bytes: bytes(svg('<rect width="4" height="4"/>')) },
        { path: "public/media/photo.jpg", bytes: bytes("jpeg") },
        { path: "public/media/old.html", delete: true },
        { path: "content/pages/x.html.json", content: "{}" },
      ]),
    ).toEqual(["public/media/page.html", "public/media/a.Svg"]);
  });
});
