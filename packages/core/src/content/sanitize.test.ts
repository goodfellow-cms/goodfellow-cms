import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize.js";

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
