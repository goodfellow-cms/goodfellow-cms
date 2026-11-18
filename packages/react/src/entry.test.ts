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
      expect(fill("<a href={title}>Go</a>", address)).toBe('<a href="">Go</a>');
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
    expect(fill("<a href={base}{path}>Go</a>", { base: "java", path: "script:alert(1)" })).toBe('<a href="">Go</a>');
    // An unquoted value left empty is written "", so what follows it stays an attribute of its own.
    expect(fill('<a href={path} class="card" title={path}>Go</a>', { path: "custom:example" })).toBe(
      '<a href="" class="card" title=custom:example>Go</a>',
    );
    // A reference the owners start and a value ends is read as the browser reads it, as one.
    expect(fill('<a href="javascript&#5{path}">Go</a>', { path: "8;alert(1)" })).toBe('<a href="javascript&#5">Go</a>');
    expect(fill('<a href="javascript&colo{path}">Go</a>', { path: "n;alert(1)" })).toBe(
      '<a href="javascript&colo">Go</a>',
    );
    expect(fill('<a href="/news&#5{path}">Go</a>', { path: "8;x" })).toBe('<a href="/news&#58;x">Go</a>');
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
    // Straight after a `<`, a value would be the tag's name, or start a comment, and so would leaving it out: it's
    // left out, and the `<` written as text.
    expect(fill("<p>1<{path}></p>", { path: "img src=x onerror=alert(1)" })).toBe("<p>1&lt;></p>");
    expect(fill("<p><!{path}</p>", { path: "--" })).toBe("<p>&lt;!</p>");
    expect(fill("<{path}img src=x onerror={path}>", { path: "alert(1)" })).toBe("&lt;img src=x onerror=alert(1)>");
    expect(fill('<!-{path}- > <a title="--> <img src=x onerror={path}> ">', { path: "-" })).toBe(
      // The value goes in the title, as a browser reads it: the <img> is the title's text.
      '&lt;!-- > <a title="--> <img src=x onerror=-> ">',
    );
    // Once the `<` is text, what follows is read as text too, never as the comment it no longer starts.
    expect(fill('<!{path}<a href="{path}">Go</a>', { path: "javascript:alert(1)" })).toBe('&lt;!<a href="">Go</a>');
    expect(fill('</{path}a title="> <img src=x onerror={path}>">', { path: "alert(1)" })).toBe(
      '&lt;/a title="> <img src=x onerror="">">',
    );
    expect(fill("<p>{path} < 2</p>", { path: "1" })).toBe("<p>1 < 2</p>");
    // A comment ends at --!>, and at a > straight after <!-- or <!---, so what follows is markup again.
    for (const comment of ["<!-- x --!>", "<!-->", "<!--->", "<!----!>"]) {
      expect(fill(`${comment}<a href="{path}">Go</a>`, { path: "javascript:alert(1)" })).toBe(
        `${comment}<a href="">Go</a>`,
      );
    }
    // But <!--!> and <!---!> don't end one: their --!> takes the opening's dashes, so the next --> does.
    for (const comment of ["<!--!>", "<!---!>"]) {
      expect(fill(`${comment} <a title="--> <img src=x onerror={path}> ">`, { path: "alert(1)" })).toBe(
        `${comment} <a title="--> <img src=x onerror=""> ">`,
      );
    }
    // Only HTML's whitespace ends an unquoted value: U+00A0 doesn't, so this is still the handler.
    expect(fill("<img src=x onerror=void(0);\u00a0x={path}>", { path: "alert(1)" })).toBe(
      "<img src=x onerror=void(0);\u00a0x=>",
    );
    // A tag's name ends at a /, so <script/x> is a script.
    expect(fill("<script/x>{path}</script>", { path: "alert(1)" })).toBe("<script/x></script>");
    // A script's end tag inside a comment's <script> is still the script's text.
    const escaped = "<script><!--<script>\n// </script>\n{path}\n</script>";
    expect(fill(escaped, { path: "alert(1)" })).toBe(escaped.replace("{path}", ""));
    // Where a script ends is read from the text as written: leaving a value out here writes that <script>.
    const joined = "<script><!--<scr{base}ipt>\n// </script>\n{path}\n</script><p>{path}</p>";
    expect(fill(joined, { base: "T", path: "alert(1)" })).toBe(
      "<script><!--<script>\n// </script>\n\n</script><p>alert(1)</p>",
    );
    // After a /, even an = starts an attribute's name, so here onerror is an attribute of its own.
    expect(fill('<img src=x x /=" onerror={path} ">', { path: "alert(1)" })).toBe('<img src=x x /=" onerror="" ">');
    expect(fill('<img src=x x/=" onerror={path} ">', { path: "alert(1)" })).toBe('<img src=x x/=" onerror="" ">');
    // And in an end tag, which ends at its first > here, after which a value is text.
    expect(fill('<script></script x /=">{path}">', { path: "&" })).toBe('<script></script x /=">&amp;">');
    // And its end tag written with a value left out of it is read whole, so nothing in it is read again as text.
    expect(fill("<script>/* <{base}/script> */{path}</script><p>{path}</p>", { base: "", path: "alert(1)" })).toBe(
      "<script>/* </script> */alert(1)</script><p>alert(1)</p>",
    );
    expect(fill("<script></scr{base}ipt>{path}</script>", { base: "", path: "<b>" })).toBe(
      "<script></script>&lt;b&gt;</script>",
    );
    // Many raw-text elements before a page's only value are each read once.
    const many = `${"<script>x</script>".repeat(20000)}<p>{path}</p>`;
    expect(fill(many, { path: "&" })).toBe(`${"<script>x</script>".repeat(20000)}<p>&amp;</p>`);
    // A long document is read, a little more at a time, through each element's end.
    const long = `${"<script>x</script><p>{path}</p>".repeat(3000)}<script>${"y".repeat(5000)}{path}</script>{path}`;
    expect(fill(long, { path: "&" })).toBe(
      `${"<script>x</script><p>&amp;</p>".repeat(3000)}<script>${"y".repeat(5000)}</script>&amp;`,
    );
    // And a text area's: its end tag written with a value left out of it is still its end.
    expect(fill('<textarea></text{base}area><a href="{path}">x</a>', { base: "", path: "javascript:alert(1)" })).toBe(
      '<textarea></textarea><a href="">x</a>',
    );
    expect(fill("<script><!-- x --></script><p>{path}</p>", { path: "it's" })).toBe(
      "<script><!-- x --></script><p>it&#39;s</p>",
    );
    // A text area's and a title's content is text, where a value is escaped, and they end at their own end tag.
    expect(fill('<textarea><!--</textarea><a href="{path}">-->', { path: "javascript:alert(1)" })).toBe(
      '<textarea><!--</textarea><a href="">-->',
    );
    expect(fill("<title>{path}</title>", { path: "<b>&" })).toBe("<title>&lt;b&gt;&amp;</title>");
    // A bogus comment ends at its first >, so what follows is markup again.
    expect(fill('<!x <a title="> <a href={path}>Go</a>', { path: "javascript:alert(1)" })).toBe(
      '<!x <a title="> <a href="">Go</a>',
    );
    expect(fill('<? x > <a href="{path}">', { path: "javascript:alert(1)" })).toBe('<? x > <a href="">');
    // Straight after a value, an = starts another attribute's name, not this one's value.
    expect(fill('<a href="/x" ="{path}">', { path: "x" })).toBe('<a href="/x" ="">');
    // A script ends only at its own end tag, not at one that only starts the same.
    expect(fill("<script>var a = '</scriptx>{path}';</script>", { path: "alert(1)" })).toBe(
      "<script>var a = '</scriptx>';</script>",
    );
  });

  it("keeps values out of what loads code, and out of SVG and MathML, which browsers read by other rules", () => {
    const fill = (html: string, title: string) =>
      applyEntry({ root: { props: {} }, content: [{ type: "Html", props: { id: "x", html } }] }, config, news, {
        collection: "news",
        slug: "a",
        file: "content/collections/news/a.json",
        path: "/news/a",
        content: { version: 1, fields: { title } },
      }).content[0]?.props.html;
    // An address on another site is a safe one, but not for a script, a base every address is read from, or a plugin.
    const remote = "https://other.example/x.js";
    for (const html of [
      '<script src="{title}"></script>',
      '<SCRIPT SRC="{title}"></SCRIPT>',
      '<base href="{title}">',
      '<object data="{title}"></object>',
      '<embed src="{title}">',
    ]) {
      expect(fill(html, remote), html).toBe(html.replace("{title}", ""));
    }
    expect(fill('<img src="{title}">', remote)).toBe(`<img src="${remote}">`);
    expect(fill('<a href="{title}">Go</a>', remote)).toBe(`<a href="${remote}">Go</a>`);
    // SVG's own attributes are read as HTML's; what's inside it isn't, nor anything after it.
    expect(fill('<svg aria-label="{title}"><text>{title}</text></svg><p>{title}</p>', "Chart")).toBe(
      '<svg aria-label="Chart"><text></text></svg><p></p>',
    );
    // Inside SVG, a <title> holds tags, which here would be a live link.
    expect(fill('<svg><title><a href="{title}">x</a></title></svg>', "javascript:alert(1)")).toBe(
      '<svg><title><a href="">x</a></title></svg>',
    );
    // And <![CDATA[ runs to ]]>, past the > that would end it in HTML.
    const cdata = '<math><![CDATA[ > <a title=" ]]> <img src=x onerror={title}> " ]]></math>';
    expect(fill(cdata, "alert(1)")).toBe(cdata.replace("{title}", ""));
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
