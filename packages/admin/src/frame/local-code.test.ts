// @vitest-environment happy-dom
import { type ContentSource, type GoodfellowConfig, loadSiteContent } from "@goodfellow-cms/core";
import { templateOnly, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig, ComponentData } from "@puckeditor/core";
import { createElement, type ElementType } from "react";
import { describe, expect, it } from "vitest";
import { localSiteCode } from "./local-code.js";

const page = (title: string) => JSON.stringify({ version: 1, data: { root: { props: { title } }, content: [] } });

const FILES: Record<string, string> = {
  "content/site.json": JSON.stringify({ version: 1, title: "Parish", description: "A parish" }),
  "content/pages/index.json": page("Home"),
  "content/pages/about.json": page("About"),
};

const source: ContentSource = {
  read: async (path) => FILES[path],
  list: async (dir) => Object.keys(FILES).filter((path) => path.startsWith(`${dir}/`)),
};

const config = {
  blocks: {
    Columns: {
      fields: { main: { type: "slot" }, side: { type: "slot" }, gap: { type: "text" } },
      render: ({ main: Main, side: Side, gap }: { main: ElementType; side: ElementType; gap: string }) =>
        createElement(
          "div",
          { className: `grid ${gap}` },
          createElement("div", { className: "main" }, createElement(Main)),
          createElement("div", { className: "side" }, createElement(Side)),
        ),
    },
    Heading: {
      fields: { text: { type: "text" } },
      // The page it's drawn on, as blocks read it.
      render: function Heading({ text }: { text: string }) {
        return createElement("h2", { "data-path": useSite().path }, text);
      },
    },
    Byline: templateOnly({
      fields: {},
      render: () => createElement("p", {}, "By someone"),
    }),
  } as unknown as Record<string, ComponentConfig>,
} as GoodfellowConfig;

const block = (type: string, props: Record<string, unknown>) => ({ type, props }) as ComponentData;

describe("drawing one block for an editor plugin", () => {
  it("draws the block as the site does, with each slot left as an empty place of its own", async () => {
    const content = await loadSiteContent(source);
    const html = await localSiteCode(config).drawBlock(content, {
      kind: "page",
      path: "/about",
      block: block("Columns", {
        id: "Columns-1",
        gap: "gap-4",
        // The blocks in slots are the editor's to draw.
        main: [block("Heading", { id: "Heading-1", text: "Not drawn" })],
      }),
    });
    const drawn = document.createElement("div");
    drawn.innerHTML = html;
    expect(drawn.firstElementChild?.className).toBe("grid gap-4");
    // Where the slot's blocks go, in the element Puck puts them in, as on the site's pages.
    expect(drawn.querySelector('.main > div > gf-slot[data-slot="main"]')?.innerHTML).toBe("");
    expect(drawn.querySelector('.side > div > gf-slot[data-slot="side"]')?.innerHTML).toBe("");
    expect(html).not.toContain("Not drawn");
  });

  it("draws it in the page it's on, and only with blocks what's edited may have", async () => {
    const content = await loadSiteContent(source);
    const code = localSiteCode(config);
    const heading = await code.drawBlock(content, {
      kind: "page",
      path: "/about",
      block: block("Heading", { id: "Heading-1", text: "Welcome" }),
    });
    expect(heading).toBe('<h2 data-path="/about">Welcome</h2>');
    // Blocks only templates have are drawn for templates alone.
    const byline = block("Byline", { id: "Byline-1" });
    await expect(code.drawBlock(content, { kind: "page", path: "/about", block: byline })).rejects.toThrow(/Byline/);
    expect(await code.drawBlock(content, { kind: "template", path: "/news/welcome", block: byline })).toContain(
      "By someone",
    );
  });
});
