// @vitest-environment happy-dom
import { type ContentSource, type GoodfellowConfig, loadSiteContent } from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { checkPublish, describeProblem } from "./site-checks.js";
import { localSiteCode } from "./site-code.js";
import { defaultStrings, type StringKey } from "./strings.js";

const page = (title: string, content: unknown[] = []) =>
  JSON.stringify({ version: 1, data: { root: { props: { title, description: title } }, content } });

const FILES: Record<string, string> = {
  "content/site.json": JSON.stringify({ version: 1, title: "Parish", description: "A parish" }),
  "content/pages/index.json": page("Home"),
};

const source: ContentSource = {
  read: async (path) => FILES[path],
  list: async (dir) => Object.keys(FILES).filter((path) => path.startsWith(`${dir}/`)),
};

const config = {
  blocks: {
    Heading: {
      fields: { text: { type: "text" }, level: { type: "text" } },
      render: ({ text, level }: { text: string; level: string }) => createElement(level, {}, text),
    },
    Picture: {
      fields: { src: { type: "text" }, alt: { type: "text" } },
      render: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
    },
    Button: {
      fields: { href: { type: "text" }, label: { type: "text" } },
      render: ({ href, label }: { href: string; label: string }) => createElement("a", { href }, label),
    },
  } as unknown as Record<string, ComponentConfig>,
} as GoodfellowConfig;

const t = (key: StringKey, values?: Record<string, string>) =>
  defaultStrings[key].replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] ?? match);

describe("checkPublish on rendered pages", () => {
  it("warns about images without alt text, skipped headings and links that don't say where they go", async () => {
    const loaded = { content: await loadSiteContent(source), media: ["public/media/photo.jpg"] };
    const checks = await checkPublish(
      source,
      loaded,
      [
        {
          path: "content/pages/index.json",
          content: page("Home", [
            { type: "Heading", props: { id: "Heading-1", text: "Welcome", level: "h1" } },
            { type: "Heading", props: { id: "Heading-2", text: "Times", level: "h3" } },
            { type: "Picture", props: { id: "Picture-1", src: "/media/photo.jpg", alt: "" } },
            { type: "Button", props: { id: "Button-1", href: "/", label: "Click here" } },
          ]),
        },
      ],
      { blocks: config.blocks, code: localSiteCode(config) },
    );
    expect(checks.blocking).toEqual([]);
    expect(checks.warnings.map((problem) => describeProblem(t, checks.content, problem))).toEqual([
      'The page "Home" has the heading "Times" at level 3, after one at level 1. Headings shouldn\'t skip a level, or people who move through a page by its headings think they\'ve missed something.',
      "The page \"Home\" has an image, photo.jpg, with no description for people who can't see it. Describe it in the image's settings, or say it's only decoration.",
      'The page "Home" has a link, "Click here", that doesn\'t say where it goes. Say what people will find there, such as "Our Mass times" rather than "Click here".',
    ]);
  });
});
