import { describe, expect, it } from "vitest";
import { cleanRichText, escapeCellText, sanitizeHtml, tableCellHtml } from "./sanitize.js";

describe("sanitizeHtml", () => {
  it("keeps text, formatting, links, images, and classes", () => {
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
    expect(sanitizeHtml('<div id="&#103;f-consent">Fake</div><p id="&#x67&#x46;-notice">Fake</p>')).toBe(
      "<div>Fake</div><p>Fake</p>",
    );
  });
});

describe("tableCellHtml", () => {
  it("keeps bold, italics, links, and line breaks, and nothing else", () => {
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

describe("cleanRichText", () => {
  it("keeps the formatting Puck's rich text editor makes, as it wrote it", () => {
    const html = [
      '<h2 style="text-align: center">Hours</h2>',
      "<p>Open <strong>daily</strong>, <em>even</em> <u>Sundays</u> <s>not</s>, <code>9:00</code><br>and later.</p>",
      '<ul><li><p>One</p></li></ul><ol start="3"><li><p>Three</p></li></ol>',
      '<blockquote><p>Quoted</p></blockquote><pre><code class="language-ts">let x = 1;</code></pre><hr>',
      '<p><a href="/about/">Us</a> and <a href="https://example.org/" target="_blank" rel="noopener noreferrer">them</a></p>',
    ].join("");
    expect(cleanRichText(html)).toBe(html);
  });

  it("leaves out what the editor doesn't make, keeping its text, so nothing loads or runs", () => {
    expect(cleanRichText('<p>See <img src="https://tracker.example/x.gif" alt="">this</p>')).toBe("<p>See this</p>");
    expect(cleanRichText('<div class="fixed inset-0"><p id="gf-consent">Fake</p></div>')).toBe("<p>Fake</p>");
    expect(cleanRichText('<p onclick="steal()" style="position:fixed">Hi</p><script>steal()</script>')).toBe(
      "<p>Hi</p>",
    );
    expect(cleanRichText('<iframe src="https://example.org"></iframe><table><tr><td>Mon</td></tr></table>')).toBe(
      "Mon",
    );
    expect(cleanRichText('<a href="javascript:steal()" target="_top" class="x">Click</a>')).toBe("<a href>Click</a>");
    expect(cleanRichText('<p style="text-align: center; color: red">Hi</p>')).toBe(
      '<p style="text-align: center">Hi</p>',
    );
    expect(cleanRichText('<p style="text-align: left">Hi</p><p style="text-align: x">Hi</p>')).toBe(
      "<p>Hi</p><p>Hi</p>",
    );
    expect(cleanRichText('<code class="bg-red-500">x</code>')).toBe("<code>x</code>");
    expect(cleanRichText('<a href="/about/" target="_self" rel="">Us</a>')).toBe('<a href="/about/">Us</a>');
  });

  it("makes plain text a paragraph, as Puck does", () => {
    expect(cleanRichText("")).toBe("");
    expect(cleanRichText("Fish & chips, 2 < 3")).toBe("<p>Fish &amp; chips, 2 &lt; 3</p>");
  });

  it("takes no longer for long runs of what it reads", () => {
    const started = performance.now();
    cleanRichText("<a".repeat(50_000));
    cleanRichText(`<p style="${"text-align: ".repeat(20_000)}">x</p>`);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
