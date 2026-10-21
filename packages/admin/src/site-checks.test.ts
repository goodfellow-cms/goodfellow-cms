import { type ContentSource, loadSiteContent } from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { checkPublish, describeProblem } from "./site-checks.js";
import { defaultStrings, type StringKey } from "./strings.js";

const page = (title: string, content: unknown[] = []) =>
  JSON.stringify({ version: 1, data: { root: { props: { title, description: title } }, content } });
const button = (id: string, href: string) => ({ type: "Button", props: { id, href } });

const FILES: Record<string, string> = {
  "content/site.json": JSON.stringify({ version: 1, title: "Parish", description: "A parish" }),
  "content/pages/index.json": page("Home", [button("Button-1", "/about")]),
  "content/pages/about.json": page("About us", [button("Button-1", "/media/photo.jpg")]),
  "content/pages/old.json": page("Old", [button("Button-1", "/gone")]),
};

const source: ContentSource = {
  read: async (path) => FILES[path],
  list: async (dir) => Object.keys(FILES).filter((path) => path.startsWith(`${dir}/`)),
};

const blocks: Record<string, ComponentConfig> = {
  Button: { fields: { href: { type: "text" } }, render: () => null } as unknown as ComponentConfig,
};

const t = (key: StringKey, values?: Record<string, string>) =>
  defaultStrings[key].replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] ?? match);

async function loaded() {
  return { content: await loadSiteContent(source), media: ["public/media/photo.jpg"] };
}

describe("checkPublish", () => {
  it("stops a publish that breaks links, naming where they are", async () => {
    const checks = await checkPublish(
      source,
      await loaded(),
      [
        { path: "content/pages/about.json", delete: true },
        { path: "public/media/photo.jpg", delete: true },
      ],
      blocks,
    );
    expect(checks.blocking.map((problem) => describeProblem(t, checks.content, problem))).toEqual([
      'The page "Home" links to /about, which isn\'t a page on the site.',
    ]);
    expect(checks.warnings).toEqual([]);
  });

  it("knows the files a publish adds, and leaves problems it didn't bring as warnings", async () => {
    const checks = await checkPublish(
      source,
      await loaded(),
      [
        { path: "content/pages/new.json", content: page("New") },
        {
          path: "content/pages/about.json",
          content: page("About us", [button("Button-1", "/media/new.jpg"), button("Button-2", "/new")]),
        },
        { path: "public/media/new.jpg", bytes: new Uint8Array([1]) },
        { path: "content/pages/old.json", content: page("Older", [button("Button-1", "/gone")]) },
      ],
      blocks,
    );
    expect(checks.blocking).toEqual([]);
    // The old page's link was already broken, so it's only a warning.
    expect(checks.warnings.map((problem) => describeProblem(t, checks.content, problem))).toEqual([
      'The page "Older" links to /gone, which isn\'t a page on the site.',
    ]);
  });
});
