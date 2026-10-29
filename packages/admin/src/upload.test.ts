// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { cleanSvg, safeMediaChanges, UploadError } from "./upload.js";

const svg = (body: string, attributes = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${attributes}>${body}</svg>`;

describe("cleanSvg", () => {
  it("keeps what a logo draws itself with", () => {
    const logo = svg(
      '<title>Saint Brigid\'s</title><defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient></defs>' +
        '<style>.a{fill:url(#g)}</style><circle class="a" cx="12" cy="12" r="10"/><use href="#g"/><use xlink:href="#g"/>' +
        '<a href="https://example.org/"><text x="2" y="20">Hi</text></a><image href="data:image/png;base64,AAAA"/>',
      ' viewBox="0 0 24 24"',
    );
    const cleaned = cleanSvg(logo) ?? "";
    for (const kept of [
      'viewBox="0 0 24 24"',
      "<title>",
      "<linearGradient",
      "<style>",
      "<circle",
      'href="#g"',
      'xlink:href="#g"',
      'href="https://example.org/"',
      "data:image/png",
    ]) {
      expect(cleaned).toContain(kept);
    }
  });

  it("removes scripts, whatever namespace prefix they're written with", () => {
    const cleaned = cleanSvg(
      svg(
        '<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script><script>alert(2)</script>' +
          '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject><set attributeName="x" to="1"/>' +
          '<x:iframe xmlns:x="http://www.w3.org/1999/xhtml" src="https://evil.example"/><rect/>',
      ),
    );
    expect(cleaned).toContain("<rect");
    expect(cleaned).not.toMatch(/script|alert|foreignObject|iframe|<set/i);
  });

  it("removes links to scripts, however they're spelled", () => {
    const cleaned = cleanSvg(
      svg(
        '<a href="java&#9;script:alert(1)"><rect/></a><a xlink:href=" JavaScript:alert(2)"><rect/></a>' +
          '<a href="java&#x0A;script:alert(3)"><rect/></a><a href="data:text/html,&lt;script&gt;alert(4)&lt;/script&gt;"><rect/></a>' +
          '<image href="data:image/svg+xml;base64,AAAA"/><circle onclick="alert(5)" ONLOAD="alert(6)"/>',
      ),
    );
    expect(cleaned).not.toMatch(/alert|href|onclick|onload/i);
    expect(cleaned?.match(/<rect/g)).toHaveLength(4);
  });

  it("removes animations that would set a link or a handler afterwards", () => {
    const cleaned = cleanSvg(
      svg(
        '<a><animate attributeName="href" values="#a;javascript:alert(1)"/><rect/></a>' +
          '<a><animate attributeName="xlink:href" to="https://example.org"/><rect/></a>' +
          '<rect><animate attributeName="onclick" to="x"/></rect>' +
          '<rect><animate attributeName="fill" values="red;java&#13;script:alert(2)"/></rect>' +
          '<rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect>',
      ),
    );
    expect(cleaned).not.toMatch(/alert|href|onclick|javascript/i);
    expect(cleaned).toContain('attributeName="opacity"');
  });

  it("removes processing instructions, comments and attributes from other namespaces", () => {
    const cleaned = cleanSvg(
      `<?xml-stylesheet type="text/xsl" href="https://evil.example/page.xsl"?><!-- hi -->${svg(
        '<rect ev:event="click" xmlns:ev="http://www.w3.org/2001/xml-events"/><!-- there -->',
      )}`,
    );
    expect(cleaned).toContain("<rect");
    expect(cleaned).not.toMatch(/xml-stylesheet|evil|<!--|ev:event/);
  });

  it("refuses files that aren't SVGs", () => {
    expect(cleanSvg("<svg><rect>")).toBeUndefined();
    expect(cleanSvg('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toBeUndefined();
    expect(cleanSvg("<svg><script>alert(1)</script></svg>")).toBeUndefined();
  });
});

describe("safeMediaChanges", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("refuses files in the media library that aren't a kind the site can use, by the name they're saved under", () => {
    expect(() => safeMediaChanges([{ path: "public/media/page.html", bytes: bytes("<script>x</script>") }])).toThrow(
      UploadError,
    );
    expect(() => safeMediaChanges([{ path: "public/media/notes.js", content: "alert(1)" }])).toThrow(UploadError);
  });

  it("cleans every SVG saved there, whatever it was chosen as, and leaves other files alone", () => {
    const [logo, photo, page, gone] = safeMediaChanges([
      { path: "public/media/logo.svg", bytes: bytes(svg('<rect width="4" height="4"/><script>alert(1)</script>')) },
      { path: "public/media/photo.jpg", bytes: bytes("jpeg") },
      { path: "content/pages/about.json", content: "{}" },
      { path: "public/media/old.html", delete: true },
    ]);
    const text = new TextDecoder().decode((logo as { bytes: Uint8Array }).bytes);
    expect(text).toContain("<rect");
    expect(text).not.toContain("script");
    expect(photo).toEqual({ path: "public/media/photo.jpg", bytes: bytes("jpeg") });
    expect(page).toEqual({ path: "content/pages/about.json", content: "{}" });
    expect(gone).toEqual({ path: "public/media/old.html", delete: true });
  });

  it("keeps an SVG that's already safe as it was written, such as one put back from Version history", () => {
    const safe = { path: "public/media/placeholder.svg", bytes: bytes(`${svg('<rect width="4" height="4"/>')}\n`) };
    expect(safeMediaChanges([safe])).toEqual([safe]);
  });

  it("refuses an SVG that isn't one", () => {
    expect(() =>
      safeMediaChanges([{ path: "public/media/logo.svg", content: "<html><script>x</script></html>" }]),
    ).toThrow(UploadError);
  });
});
