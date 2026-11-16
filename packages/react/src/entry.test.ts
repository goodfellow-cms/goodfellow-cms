import { type Collection, collectionFileSchema } from "@goodfellow-cms/core";
import type { Config } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { applyEntry, isHtmlField } from "./entry.js";

const config = {
  components: {
    Heading: { fields: { text: { type: "text" } }, render: () => null },
    Html: { fields: { html: { type: "textarea", metadata: { html: true } } }, render: () => null },
    Questions: {
      fields: {
        items: {
          type: "array",
          arrayFields: { question: { type: "text" }, answer: { type: "richtext" } },
        },
        more: { type: "object", objectFields: { note: { type: "richtext" } } },
      },
      render: () => null,
    },
  },
} as unknown as Config;

const news: Collection = {
  id: "news",
  file: "content/collections/news/_collection.json",
  settings: collectionFileSchema.parse({
    version: 1,
    name: "News",
    entryName: "Story",
    fields: [{ name: "title", label: "Title", type: "text" }],
  }),
  entries: [],
};

describe("filling in an item's values", () => {
  it("escapes them in HTML a block shows as it is, so writing an item never writes the page's markup", () => {
    expect(isHtmlField({ type: "textarea", metadata: { html: true } })).toBe(true);
    expect(isHtmlField({ type: "textarea" })).toBe(false);
    const filled = applyEntry(
      {
        root: { props: {} },
        content: [
          { type: "Heading", props: { id: "h", text: "{title}" } },
          { type: "Html", props: { id: "x", html: '<div class="news">{title}</div>' } },
        ],
      },
      config,
      news,
      {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title: '<img src=x onerror="alert(1)">' } },
      },
    );
    expect(filled.content[0]?.props.text).toBe('<img src=x onerror="alert(1)">');
    expect(filled.content[1]?.props.html).toBe(
      '<div class="news">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</div>',
    );
  });

  it("puts them into HTML by where each sits, so a value can't end an attribute or run as an address", () => {
    /** Custom HTML `html` with `{title}` filled in from `title`. */
    const fill = (html: string, title: string) =>
      applyEntry({ root: { props: {} }, content: [{ type: "Html", props: { id: "x", html } }] }, config, news, {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title } },
      }).content[0]?.props.html;
    // A single quote ends a single-quoted value, and a space or > an unquoted one.
    expect(fill("<a href='/x' title='{title}'>Go</a>", "x' autofocus onfocus='alert(1)")).toBe(
      "<a href='/x' title='x&#39;&#32;autofocus&#32;onfocus&#61;&#39;alert(1)'>Go</a>",
    );
    expect(fill("<img alt={title} src=/a.png>", "x onerror=alert(1)")).toBe(
      "<img alt=x&#32;onerror&#61;alert(1) src=/a.png>",
    );
    // An address that's followed or loaded is left out where it could run script, however it's spelled.
    for (const address of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,x",
    ]) {
      expect(fill('<iframe src="{title}"></iframe>', address)).toBe('<iframe src=""></iframe>');
      expect(fill("<a href={title}>Go</a>", address)).toBe("<a href=>Go</a>");
    }
    expect(fill('<iframe src="{title}"></iframe>', "https://www.youtube-nocookie.com/embed/x")).toBe(
      '<iframe src="https://www.youtube-nocookie.com/embed/x"></iframe>',
    );
    // Further into an address, a value is only part of it.
    expect(fill('<a href="/go?to={title}">Go</a>', "javascript:x")).toBe('<a href="/go?to=javascript:x">Go</a>');
    // Handlers, srcdoc, scripts, styles and the tag itself are code or markup whatever the escaping, so nothing goes in.
    expect(fill(`<button onclick="go('{title}')">Go</button>`, "x');alert(1);('")).toBe(
      `<button onclick="go('')">Go</button>`,
    );
    expect(fill('<iframe srcdoc="{title}"></iframe>', "<script>alert(1)</script>")).toBe('<iframe srcdoc=""></iframe>');
    expect(fill("<script>var t = {title};</script><p>{title}</p>", "alert(1)")).toBe(
      "<script>var t = ;</script><p>alert(1)</p>",
    );
    expect(fill("<style>a{color:{title}}</style>", "red}body{display:none")).toBe("<style>a{color:}</style>");
    expect(fill("<div {title}>x</div>", "onmouseover=alert(1)")).toBe("<div >x</div>");
    // Between tags and in comments, it's text.
    expect(fill("<p>{title}</p><!-- {title} -->", "it's <b>&")).toBe(
      "<p>it&#39;s &lt;b&gt;&amp;</p><!-- it&#39;s &lt;b&gt;&amp; -->",
    );
  });

  it("judges an address by all of it, and keeps values out of tag names and past a comment's end", () => {
    const parts: Collection = {
      ...news,
      settings: collectionFileSchema.parse({
        version: 1,
        name: "News",
        entryName: "Story",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "base", label: "Base", type: "text" },
          { name: "path", label: "Path", type: "text" },
        ],
      }),
    };
    const fill = (html: string, fields: Record<string, string>) =>
      applyEntry({ root: { props: {} }, content: [{ type: "Html", props: { id: "x", html } }] }, config, parts, {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title: "T", ...fields } },
      }).content[0]?.props.html;
    // Two values, or a value and the owners' text, can spell a scheme neither does alone.
    expect(fill('<a href="{base}{path}">Go</a>', { base: "java", path: "script:alert(1)" })).toBe('<a href="">Go</a>');
    expect(fill("<a href={base}{path}>Go</a>", { base: "java", path: "script:alert(1)" })).toBe("<a href=>Go</a>");
    expect(fill('<a href="{base}script:alert(1)">Go</a>', { base: "java" })).toBe('<a href="script:alert(1)">Go</a>');
    expect(fill('<a href="{base}&#58;alert(1)">Go</a>', { base: "javascript" })).toBe('<a href="&#58;alert(1)">Go</a>');
    expect(fill('<a href="{base}&colon;alert(1)">Go</a>', { base: "javascript" })).toBe(
      '<a href="&colon;alert(1)">Go</a>',
    );
    // Safe ones, and values after the owners' own scheme, go in as before.
    expect(fill('<a href="{base}{path}">Go</a>', { base: "https://example.org", path: "/a b" })).toBe(
      '<a href="https://example.org/a&#32;b">Go</a>',
    );
    expect(fill('<a href="webcal://example.org/{path}.ics">Add</a>', { path: "events" })).toBe(
      '<a href="webcal://example.org/events.ics">Add</a>',
    );
    // Straight after a `<`, a value would be the tag's name, or start a comment.
    expect(fill("<p>1<{path}></p>", { path: "img src=x onerror=alert(1)" })).toBe("<p>1<></p>");
    expect(fill("<p><!{path}</p>", { path: "--" })).toBe("<p><!</p>");
    expect(fill("<p>{path} < 2</p>", { path: "1" })).toBe("<p>1 < 2</p>");
    // A comment ends at --!>, and at a > straight after <!-- or <!---, so what follows is markup again.
    for (const comment of ["<!-- x --!>", "<!-->", "<!--->"]) {
      expect(fill(`${comment}<a href="{path}">Go</a>`, { path: "javascript:alert(1)" })).toBe(
        `${comment}<a href="">Go</a>`,
      );
    }
    // A script ends only at its own end tag, not at one that only starts the same.
    expect(fill("<script>var a = '</scriptx>{path}';</script>", { path: "alert(1)" })).toBe(
      "<script>var a = '</scriptx>';</script>",
    );
  });

  it("escapes them in rich text inside lists and objects too", () => {
    const filled = applyEntry(
      {
        root: { props: {} },
        content: [
          {
            type: "Questions",
            props: {
              id: "q",
              items: [{ question: "{title}?", answer: "<p>{title}</p>" }],
              more: { note: "<p>{title}</p>" },
            },
          },
        ],
      },
      config,
      news,
      {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title: "<b>x</b>" } },
      },
    );
    const props = filled.content[0]?.props as { items: { question: string; answer: string }[]; more: { note: string } };
    expect(props.items[0]).toEqual({ question: "<b>x</b>?", answer: "<p>&lt;b&gt;x&lt;/b&gt;</p>" });
    expect(props.more.note).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
  });
});
