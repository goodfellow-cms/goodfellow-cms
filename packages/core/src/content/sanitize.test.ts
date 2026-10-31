import { describe, expect, it } from "vitest";
import { escapeCellText, sanitizeHtml, tableCellHtml } from "./sanitize.js";

describe("sanitizeHtml", () => {
  it("keeps text, formatting, links, images and classes", () => {
    const html =
      '<h2 class="title">Hours</h2><p>Open <strong>daily</strong>, see <a href="/about" target="_blank">us</a>.</p><img src="/media/a.jpg" alt="A" class="w-full"><table><tr><td>Mon</td></tr></table>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("leaves out anything that could run code or pass for part of the page", () => {
    expect(sanitizeHtml('<p onclick="steal()">Hi</p><script>steal()</script>')).toBe("<p>Hi</p>");
    expect(sanitizeHtml('<img src="/media/x.png" onerror="steal()">')).toBe('<img src="/media/x.png">');
    expect(sanitizeHtml('<a href="javascript:steal()">Click</a>')).toBe("<a href>Click</a>");
    expect(sanitizeHtml('<a href=" data:text/html,<script>x</script>">x</a>')).toBe("<a href>x</a>");
    expect(sanitizeHtml('<iframe src="https://example.org"></iframe><style>body{display:none}</style>Ok')).toBe("Ok");
    expect(sanitizeHtml('<div style="position:fixed;inset:0">Fake</div>')).toBe("<div>Fake</div>");
    expect(sanitizeHtml('<form action="https://example.org"><input name="password"></form>')).toBe("");
  });

  it("keeps ids, but none of the ones Goodfellow's own scripts look up", () => {
    expect(sanitizeHtml('<h2 id="hours">Hours</h2><div id="gf-consent">Fake</div>')).toBe(
      '<h2 id="hours">Hours</h2><div>Fake</div>',
    );
  });
});

describe("tableCellHtml", () => {
  it("keeps bold, italics, links and line breaks, and nothing else", () => {
    expect(tableCellHtml('<strong>Sunday</strong><br><em>and</em> <a href="/mass" title="Times">Mass</a>')).toBe(
      '<strong>Sunday</strong><br><em>and</em> <a href="/mass" title="Times">Mass</a>',
    );
    expect(tableCellHtml('<p class="x">One</p><h2>Two</h2><img src="/media/a.jpg">')).toBe("OneTwo");
    expect(tableCellHtml('<b onclick="steal()">Hi</b><script>steal()</script>')).toBe("<b>Hi</b>");
    expect(tableCellHtml('<a href="javascript:steal()" target="_blank">Click</a>')).toBe("<a href>Click</a>");
  });

  it("keeps plain text from before cells could be formatted saying the same once escaped", () => {
    expect(tableCellHtml(escapeCellText("Fish & chips <£5"))).toBe("Fish &amp; chips &lt;£5");
  });
});
