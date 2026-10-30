import { describe, expect, it } from "vitest";
import {
  canFormatMarkdown,
  headingSlug,
  isSafeUrl,
  markdownHeadings,
  markdownParts,
  markdownText,
  markdownToHtml,
  parseMarkdownEntry,
  serializeMarkdownEntry,
} from "./markdown.js";
import { collectionFileSchema } from "./schemas.js";

const docs = collectionFileSchema.parse({
  version: 1,
  name: "Docs",
  entryName: "Page",
  fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "body", label: "Text", type: "richtext" },
    { name: "order", label: "Order", type: "number" },
  ],
  markdown: { body: "body" },
});

describe("Markdown entries", () => {
  it("write version and fields in the collection's order as front matter, and the body after it", () => {
    const text = serializeMarkdownEntry(docs, {
      body: "Some *text*.\n\n",
      order: 3,
      title: "Yes: or no?",
      extra: "kept",
    });
    expect(text).toBe('---\nversion: 1\ntitle: "Yes: or no?"\norder: 3\nextra: kept\n---\n\nSome *text*.\n');
    expect(parseMarkdownEntry(text, "body")).toEqual({
      version: 1,
      fields: { title: "Yes: or no?", order: 3, extra: "kept", body: "Some *text*." },
    });
  });

  it("keep text that looks like other kinds of value as text", () => {
    const text = serializeMarkdownEntry(docs, { title: "2026", order: 1 });
    expect(text).toBe('---\nversion: 1\ntitle: "2026"\norder: 1\n---\n');
    expect(parseMarkdownEntry(text, "body").fields).toEqual({ title: "2026", order: 1, body: "" });
  });

  it("end front matter only at a line of its own", () => {
    const text = "---\nversion: 1\ntitle: Before and after ---\nsummary: Still front matter\n---\nThe body\n";
    expect(parseMarkdownEntry(text, "body").fields).toEqual({
      title: "Before and after ---",
      summary: "Still front matter",
      body: "The body",
    });
    expect(parseMarkdownEntry("---\n---\nOnly a body\n", "body").fields).toEqual({ body: "Only a body" });
  });

  it("explain files they can't read", () => {
    expect(() => parseMarkdownEntry("# Hello", "body")).toThrow(/front matter/);
    expect(() => parseMarkdownEntry("---\ntitle: [unclosed\n---\n", "body")).toThrow(/isn't valid YAML/);
    expect(() => parseMarkdownEntry("---\n- a list\n---\n", "body")).toThrow(/lists fields/);
  });
});

describe("markdownToHtml", () => {
  it("renders GitHub-flavored Markdown, with ids on headings", () => {
    const html = markdownToHtml("# Set up\n\n## Set up\n\n| A | B |\n|---|---|\n| 1 | ~~2~~ |\n");
    expect(html).toContain('<h1 id="set-up">Set up</h1>');
    expect(html).toContain('<h2 id="set-up-1">Set up</h2>');
    expect(html).toContain("<td><del>2</del></td>");
  });

  it("shows HTML as text, and leaves out addresses that could run code", () => {
    const html = markdownToHtml(
      '<script>alert(1)</script>\n\nA <b onclick="x">tag</b>, [a link](javascript:alert(1)), [another](JaVaScRiPt:x) and ![a picture](data:text/html,x)\n\n[ok](/about) [mail](mailto:a@example.org)',
    );
    expect(html).not.toMatch(/<script|<b |href="javascript|src="data/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(" a link,");
    expect(html).toContain('<a href="/about">ok</a>');
    expect(html).toContain('<a href="mailto:a@example.org">mail</a>');
  });

  it("highlights code with the function given, or shows it plainly", () => {
    const markdown = "```ts\nconst a = 1 < 2;\n```";
    expect(markdownToHtml(markdown)).toBe('<pre><code class="language-ts">const a = 1 &lt; 2;\n</code></pre>\n');
    const html = markdownToHtml(markdown, {
      highlight: (code, language) => `<pre data-lang="${language}">${code.length}</pre>`,
    });
    expect(html).toBe('<pre data-lang="ts">16</pre>\n');
  });
});

describe("headings", () => {
  it("lists headings with the ids markdownToHtml gives them", () => {
    expect(markdownHeadings("# Intro\n\nText\n\n## Install `goodfellow`\n\n## Intro")).toEqual([
      { depth: 1, text: "Intro", id: "intro" },
      { depth: 2, text: "Install goodfellow", id: "install-goodfellow" },
      { depth: 2, text: "Intro", id: "intro-1" },
    ]);
    expect(headingSlug("What's new in 2.0?")).toBe("whats-new-in-20");
  });

  it("tells safe addresses apart", () => {
    for (const url of ["/media/a.png", "about", "#top", "https://example.org", "mailto:a@example.org", "tel:555"]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
    for (const url of ["javascript:x", " javascript:x", "data:text/html,x", "vbscript:x"]) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });
});

describe("canFormatMarkdown", () => {
  it("accepts what a formatted editor can show, and nothing else", () => {
    expect(
      canFormatMarkdown(
        "# Hi\n\n**Bold**, *italic*, ~~gone~~, `code` and [a link](/a).\n\n- one\n- two\n\n> Quote\n\n```ts\nx\n```\n\n---",
      ),
    ).toBe(true);
    for (const markdown of ["| a |\n|---|\n| 1 |", "![p](/p.png)", "<div>x</div>", "- [ ] task", "[a][1]\n\n[1]: /x"]) {
      expect(canFormatMarkdown(markdown), markdown).toBe(false);
    }
  });
});

describe("markdownParts", () => {
  it("splits out code blocks, keeping heading ids counted across the parts", () => {
    const parts = markdownParts("# Use\n\n```sh\nnpm i\n```\n\n# Use\n\n- a\n\n  ```\n  nested\n  ```", {
      highlight: (code) => (code === "npm i" ? "<pre>highlighted</pre>" : undefined),
    });
    expect(parts).toEqual([
      { kind: "html", html: '<h1 id="use">Use</h1>\n' },
      { kind: "code", code: "npm i", language: "sh", html: "<pre>highlighted</pre>" },
      { kind: "html", html: expect.stringContaining('<h1 id="use-1">Use</h1>') },
    ]);
    expect(parts[2]?.kind === "html" && parts[2].html).toContain("<pre><code>nested\n</code></pre>");
  });

  it("gives plain text for summaries", () => {
    expect(markdownText("# Hi\n\nSome **bold** & <i>more</i>.")).toBe("Hi Some bold & <i>more</i>.");
  });
});

describe("markdownToHtml with links to other sites in new tabs", () => {
  it("opens other sites' links in a new tab when asked, and the site's own in the same tab", () => {
    const html = markdownToHtml("[GitHub](https://github.com), [About](/about) and [News](https://example.org/news)", {
      externalLinks: { newTab: true, siteUrl: "https://example.org" },
    });
    expect(html).toContain('<a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>');
    expect(html).toContain('<a href="/about">About</a>');
    expect(html).toContain('<a href="https://example.org/news">News</a>');
    expect(markdownToHtml("[GitHub](https://github.com)")).not.toContain("target");
  });
});
