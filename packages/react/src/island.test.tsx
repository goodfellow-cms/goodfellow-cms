import { type GoodfellowConfig, type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createContext, memo, type ReactNode, useId, useState } from "react";
import { describe, expect, it } from "vitest";
import { fillSlots, type IslandToRender, island, setIslandRenderer } from "./island.js";
import { createPageRenderer } from "./server.js";
import { useSite } from "./site-context.js";

// What `goodfellow`'s Vite plugin makes of a "use client" module's exports.
const Counter = island(
  function Counter({ label, start = 0 }: { label: string; start?: number }) {
    const [count] = useState(start);
    const { path } = useSite();
    return (
      <button type="button">
        {label} {count} on {path}
      </button>
    );
  },
  "blocks/counter.tsx",
  "Counter",
);

const Labelled = island(
  function Labelled({ text }: { text: string }) {
    const id = useId();
    return (
      <label htmlFor={id}>
        {text}
        <input id={id} />
      </label>
    );
  },
  "blocks/labelled.tsx",
  "Labelled",
);

const Disclosure = island(
  function Disclosure({ open, title, children }: { open: boolean; title: ReactNode; children: ReactNode }) {
    return (
      <section>
        <h2>{title}</h2>
        {open && children}
        {/* Another Client Component rendered by this one is part of this island. */}
        <Counter label="Inner" />
      </section>
    );
  },
  "blocks/disclosure.tsx",
  "Disclosure",
);

const Fussy = island((_props: { onClick?: () => void; when?: Date }) => <p />, "blocks/fussy.tsx", "Fussy");

const config: GoodfellowConfig = {
  blocks: {
    Counter: { render: ({ label }) => <Counter label={String(label)} start={2} /> },
    Labelled: { render: () => <Labelled text="Name" /> },
    Disclosure: {
      render: ({ open }) => (
        <Disclosure open={open === true} title={<em>Title</em>}>
          <p>Server content</p>
          <Counter label="Nested" />
        </Disclosure>
      ),
    },
    Function: { render: () => <Fussy onClick={() => {}} /> },
    Date: { render: () => <Fussy when={new Date(0)} /> },
    Plain: { render: () => <p>No islands</p> },
  },
};

const content: SiteContent = {
  settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph" }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [],
  customCss: "",
};

function page(blocks: Array<{ type: string; props?: Record<string, unknown> }>): Page {
  return {
    path: "/about",
    file: "content/pages/about.json",
    content: {
      version: 1,
      data: {
        root: { props: {} },
        content: blocks.map((block, index) => ({ type: block.type, props: { id: `b${index}`, ...block.props } })),
      },
    },
  };
}

const renderPage = createPageRenderer(config);
const islands = { script: "/assets/islands.js", preload: ["/assets/react.js"], base: "/site/" };

function attribute(html: string, name: string): string[] {
  return Array.from(html.matchAll(new RegExp(`${name}="([^"]*)"`, "g")), (match) => match[1] ?? "");
}

describe("islands", () => {
  it("renders a Client Component with what the browser needs to run it", async () => {
    const html = await renderPage(content, page([{ type: "Counter", props: { label: "Clicked" } }]), { islands });
    expect(html).toMatch(
      /<gf-island data-gf-island="blocks\/counter.tsx" data-gf-export="Counter" data-gf-id="[A-Za-z0-9_-]+" data-gf-props="\{&quot;label&quot;:&quot;Clicked&quot;,&quot;start&quot;:2\}" style="display:contents"><button type="button">Clicked<!-- --> <!-- -->2<!-- --> on <!-- -->\/about<\/button><\/gf-island>/,
    );
    const end = html.slice(html.indexOf("</main>"));
    expect(end).toContain('<script type="application/json" id="gf-site">{"settings":');
    expect(end).toContain('"path":"/about"');
    expect(end).toContain('"base":"/site/"');
    expect(end).toContain('<link rel="modulepreload" href="/assets/react.js"/>');
    expect(end).toMatch(/<script type="module" src="\/assets\/islands.js"><\/script><\/body><\/html>$/);
  });

  it("loads no JavaScript on pages without Client Components", async () => {
    const html = await renderPage(content, page([{ type: "Plain" }]), { islands });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("gf-island");
  });

  it("gives each island the ids the browser will give it", async () => {
    const html = await renderPage(content, page([{ type: "Labelled" }, { type: "Labelled" }]), { islands });
    const [first, second] = attribute(html, "data-gf-id");
    expect(first).not.toBe(second);
    // Rendered as its own root with the island's prefix, as hydrateIslands() does in the browser.
    expect(attribute(html, "for")).toEqual(attribute(html, "<input id"));
    expect(attribute(html, "for")[0]).toContain(`${first}-`);
    expect(attribute(html, "for")[1]).toContain(`${second}-`);
  });

  it("renders islands with another renderer where the build gives one, such as Preact's", async () => {
    const asked: IslandToRender[] = [];
    setIslandRenderer(async (island) => {
      asked.push(island);
      const title = (island.props as { title?: { $gfSlot: string } }).title;
      const slot = title ? `<gf-slot data-gf-slot="${title.$gfSlot}" style="display:contents"></gf-slot>` : "";
      return `<p>Drawn for ${island.prefix}</p>${slot}`;
    });
    try {
      const html = await renderPage(content, page([{ type: "Disclosure", props: { open: true } }]), { islands });
      const [id] = attribute(html, "data-gf-id");
      // The Disclosure, and the Counter in the content passed to it, an island of its own.
      expect(asked.map((island) => island.name)).toEqual(["Disclosure", "Counter"]);
      expect(asked[0]).toMatchObject({
        module: "blocks/disclosure.tsx",
        name: "Disclosure",
        prefix: `${id}-`,
        slots: { marker: "$gfSlot", tag: "gf-slot" },
        props: { open: true, title: { $gfSlot: `${id}.0` }, children: { $gfSlot: `${id}.1` } },
      });
      expect(asked[0]?.site.path).toBe("/about");
      // Its HTML is the island's, with the content passed to it put in its slots, as with React's.
      expect(html).toContain(
        `<p>Drawn for ${id}-</p><gf-slot data-gf-slot="${id}.0" style="display:contents"><em>Title</em></gf-slot>`,
      );
    } finally {
      setIslandRenderer(undefined);
    }
  });

  it("renders content passed to a Client Component into its slots", async () => {
    const html = await renderPage(content, page([{ type: "Disclosure", props: { open: true } }]), { islands });
    const [outer] = attribute(html, "data-gf-id");
    const props = JSON.parse(attribute(html, "data-gf-props")[0]?.replace(/&quot;/g, '"') ?? "");
    expect(props).toEqual({ open: true, title: { $gfSlot: `${outer}.0` }, children: { $gfSlot: `${outer}.1` } });
    expect(html).toContain(
      `<h2><gf-slot data-gf-slot="${outer}.0" style="display:contents"><em>Title</em></gf-slot></h2>`,
    );
    expect(html).toContain(
      `<gf-slot data-gf-slot="${outer}.1" style="display:contents"><p>Server content</p><gf-island`,
    );
    expect(html).not.toContain("<template");
    // The counter in the content is an island of its own; the one Disclosure renders itself is part of Disclosure.
    expect(attribute(html, "data-gf-props")).toHaveLength(2);
    expect(html).toContain('data-gf-props="{&quot;label&quot;:&quot;Nested&quot;}"');
    expect(html).toContain("Inner<!-- --> <!-- -->0");
  });

  it("keeps content a Client Component didn't show for later", async () => {
    const html = await renderPage(content, page([{ type: "Disclosure", props: { open: false } }]), { islands });
    const [outer] = attribute(html, "data-gf-id");
    expect(html).toContain(`</gf-island><template data-gf-slot="${outer}.1"><p>Server content</p><gf-island`);
    expect(html).not.toContain(`<template data-gf-slot="${outer}.0"`);
  });

  it("refuses props that can't be sent to the browser", async () => {
    await expect(renderPage(content, page([{ type: "Function" }]), { islands })).rejects.toThrow(
      'The Client Component Fussy in blocks/fussy.tsx was given a function as its "onClick" prop.',
    );
    await expect(renderPage(content, page([{ type: "Date" }]), { islands })).rejects.toThrow(
      'was given a Date object as its "when" prop.',
    );
  });

  it("leaves exports that aren't components alone", () => {
    expect(island("text", "blocks/x.tsx", "x")).toBe("text");
    expect(island(42, "blocks/x.tsx", "y")).toBe(42);
    const context = createContext(1);
    expect(island(context, "blocks/x.tsx", "Context")).toBe(context);
    expect(
      island(
        memo(() => null),
        "blocks/x.tsx",
        "Memo",
      ),
    ).toBeTypeOf("function");
  });
});

describe("fillSlots", () => {
  const slot = (id: string, inner = "") => `<gf-slot data-gf-slot="${id}" style="display:contents">${inner}</gf-slot>`;

  it("fills slots in islands inside other islands' slots", () => {
    const html = [
      `<gf-island>${slot("a.0")}</gf-island>`,
      `<template data-gf-slot="a.0"><p>One</p><gf-island>${slot("b.0")}${slot("b.0")}</gf-island>`,
      `<template data-gf-slot="b.0"><template><i>plain</i></template>Two</template></template>`,
    ].join("");
    expect(fillSlots(html)).toBe(
      `<gf-island>${slot("a.0", `<p>One</p><gf-island>${slot("b.0", "<template><i>plain</i></template>Two")}${slot("b.0", "<template><i>plain</i></template>Two")}</gf-island>`)}</gf-island>`,
    );
  });

  it("counts only templates, never text that looks like one in the site's own code", () => {
    const filled = `<gf-island>${slot("a.0", "<b>Passed</b>")}</gf-island>`;
    const page = (code: string) =>
      `<head>${code}</head><gf-island>${slot("a.0")}</gf-island><template data-gf-slot="a.0"><b>Passed</b></template>`;
    for (const code of [
      `<script>var t = "<template>";</script>`,
      `<script>document.write("</template>")</script>`,
      "<style>/* <template> */</style>",
      "<!-- <template> -->",
      `<meta name="x" content="a > <template>">`,
      "</template>",
      // Every element whose content is text, which ends only at its own end tag.
      "<xmp><template></xmp>",
      "<noscript><template></noscript>",
      "<iframe><template></iframe>",
      "<noembed><template></noembed>",
      "<noframes><template></noframes>",
      "<textarea></template></textarea>",
      `<script>var t = "</scriptx><template>";</script>`,
      // A quote opens a value only just after an =; elsewhere it's part of the name or value.
      `<p title=it"s>`,
      `<p a"b>`,
      // Comments end at --!>, and at a > straight after <!-- or <!---, but not at <!--!> or <!---!>.
      "<!-- a --!>",
      "<!-->",
      "<!--->",
      "<!----!>",
      "<!--!> <template> -->",
      "<!---!> <template> -->",
      // A script's end tag inside a comment's <script> is still the script's text.
      "<script><!--<script>\n// </script>\n// <template>\n</script>",
      // End tags' attributes, bogus comments, and an = in an unquoted value.
      `</div title="<template>">`,
      "<!x <template>>",
      "<?x <template>?>",
      `<p title=x=">`,
      // A letter whose lowercase is longer, which mustn't move what comes after it.
      "<p>İ</p>",
      // In SVG and MathML a title or text area is an element like any other, unless an integration point or a tag
      // that ends them makes it HTML's again.
      "<svg><title/></svg>",
      "<math><textarea></math>",
      "<svg><foreignObject><textarea><template></textarea></foreignObject></svg>",
      "<svg><foreignObject><textarea></foreignObject></svg><template></textarea>",
      "<svg><desc><title><template></title></desc></svg>",
      "<svg><p><title><template></title>",
    ]) {
      expect(fillSlots(page(code)), code).toBe(`<head>${code}</head>${filled}`);
    }
    // Straight before the template, where a tag read too far would take its start tag.
    // After a /, an = starts an attribute's name, so `="` is a name, not a value, and the tag ends at its >.
    for (const code of [`<p title=x=">`, `</div title="><template>">`, `<p x /=">`, `<p x/=">`]) {
      const before = `<gf-island>${slot("a.0")}</gf-island>${code}<template data-gf-slot="a.0"><b>Passed</b></template>`;
      expect(fillSlots(before), code).toBe(`${filled}${code}`);
    }
    // Everything after <plaintext> is text.
    const plain = `<plaintext><gf-island>${slot("a.0")}</gf-island><template data-gf-slot="a.0">x</template>`;
    expect(fillSlots(plain)).toBe(plain);
  });

  it("reads any page in one pass, however its tags are written", () => {
    const filled = `<gf-island>${slot("a.0", "<b>Passed</b>")}</gf-island>`;
    const island = `<gf-island>${slot("a.0")}</gf-island><template data-gf-slot="a.0"><b>Passed</b></template>`;
    expect(fillSlots(`${island}<p title="${"<a ".repeat(20)}"></p>`)).toBe(
      `${filled}<p title="${"<a ".repeat(20)}"></p>`,
    );
    // Tags, comments and quotes that never end, which a backtracking pattern takes far longer than this to read.
    for (const rest of [
      `<a${"!".repeat(200_000)}`,
      "<a".repeat(100_000),
      "<!--".repeat(100_000),
      `<a "${"'".repeat(100_000)}`,
      // Comments that each end, read each once.
      "<!-- x -->".repeat(50_000),
    ]) {
      const started = performance.now();
      expect(fillSlots(`${island}${rest}`)).toBe(`${filled}${rest}`);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });

  it("keeps templates whose slots weren't rendered", () => {
    const html = `<gf-island></gf-island><template data-gf-slot="a.0">Later</template><p>After</p>`;
    expect(fillSlots(html)).toBe(html);
  });
});
