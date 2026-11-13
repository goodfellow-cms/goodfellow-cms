import { type ContentSource, type GoodfellowConfig, loadSiteContent, SignInError } from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { localSiteCode } from "./frame/local-code.js";
import { checkPublish, describeProblem, readShown } from "./site-checks.js";
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
const config = { blocks } as GoodfellowConfig;

const t = (key: StringKey, values?: Record<string, string>) =>
  defaultStrings[key].replace(/\{(\w+)\}/g, (match, name: string) => values?.[name] ?? match);

async function loaded() {
  return { content: await loadSiteContent(source), media: ["public/media/photo.jpg"] };
}

describe("readShown", () => {
  it("gives the site with its sources' items, or says a source can't be read, leaving signing in to its handler", async () => {
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": JSON.stringify({
        version: 1,
        name: "Jobs",
        entryName: "Job",
        path: "/jobs/{slug}",
        fields: [{ name: "title", label: "Title", type: "text" }],
      }),
    };
    const content = await loadSiteContent({
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    });
    const failing = (error: Error) => ({
      jobs: {
        items: async (): Promise<never> => {
          throw error;
        },
      },
    });
    expect(await readShown(content, undefined)).toEqual({});
    const read = await readShown(content, {
      jobs: { items: async () => [{ slug: "welder", fields: { title: "W" } }] },
    });
    expect(read.shown?.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toEqual([
      "welder",
    ]);
    expect(read.unreadSources).toBeUndefined();
    expect(await readShown(content, failing(new Error("The database didn't answer.")))).toEqual({
      unreadSources: true,
    });
    await expect(readShown(content, failing(new SignInError("invalid", "Sign in again.")))).rejects.toBeInstanceOf(
      SignInError,
    );
  });
});

describe("checkPublish", () => {
  it("stops a publish that breaks links, naming where they are", async () => {
    const checks = await checkPublish(
      source,
      await loaded(),
      [
        { path: "content/pages/about.json", delete: true },
        { path: "public/media/photo.jpg", delete: true },
      ],
      { blocks: config.blocks, code: localSiteCode(config) },
    );
    expect(checks.blocking.map((problem) => describeProblem(t, checks.content, problem))).toEqual([
      'The page "Home" links to /about, which isn\'t a page on the site.',
    ]);
    expect(checks.warnings).toEqual([]);
  });

  it("knows the pages of items that come from a source, which aren't the site's files", async () => {
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": JSON.stringify({
        version: 1,
        name: "Jobs",
        entryName: "Job",
        path: "/jobs/{slug}",
        fields: [{ name: "title", label: "Title", type: "text" }],
      }),
    };
    const withJobs: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    const sources = { jobs: { items: async () => [{ slug: "welder", fields: { title: "Welder" } }] } };
    const content = await loadSiteContent(withJobs);
    const linking = [{ path: "content/pages/new.json", content: page("New", [button("Button-1", "/jobs/welder")]) }];
    const checks = await checkPublish(withJobs, { content, media: [] }, linking, {
      blocks: config.blocks,
      code: localSiteCode(config),
      sources,
    });
    expect(checks.blocking).toEqual([]);
    // Without its source, the item has no page, so the link goes nowhere.
    const without = await checkPublish(withJobs, { content, media: [] }, linking, {
      blocks: config.blocks,
      code: localSiteCode(config),
    });
    expect(without.blocking.map((problem) => problem.kind)).toEqual(["missing-page"]);
    // A source that can't be read just now stops the publish, rather than pass it unchecked, naming the collection.
    let answering = false;
    const flaky = {
      jobs: {
        items: async () => {
          if (!answering) throw new Error("The database didn't answer.");
          return [{ slug: "welder", fields: { title: "Welder" } }];
        },
      },
    };
    const site = { blocks: config.blocks, code: localSiteCode(config), sources: flaky };
    const unread = await checkPublish(withJobs, { content, media: [] }, linking, site);
    expect(unread.unread).toEqual(["jobs"]);
    expect(unread.blocking).toEqual([]);
    // Publishing again asks the source again.
    answering = true;
    const read = await checkPublish(withJobs, { content, media: [] }, linking, site);
    expect(read.unread).toBeUndefined();
    expect(read.blocking).toEqual([]);
  });

  it("stops a publish that would take an item a source gives off the site, and never reads the files it replaces", async () => {
    const jobs = {
      version: 1,
      name: "Jobs",
      entryName: "Job",
      path: "/jobs/{slug}",
      fields: [{ name: "title", label: "Title", type: "text" }],
    };
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": JSON.stringify(jobs),
      // A file the source's items replace, which loading would refuse.
      "content/collections/jobs/broken.json": JSON.stringify({ version: 1, fields: { title: 42 } }),
    };
    const withJobs: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    const sources = { jobs: { items: async () => [{ slug: "about", fields: { title: "About the job" } }] } };
    const content = await loadSiteContent(withJobs, { sourced: ["jobs"] });
    const site = { blocks: config.blocks, code: localSiteCode(config), sources };
    const { shown } = await readShown(content, sources);
    // Nothing that changes the item's address: the publish is checked as any.
    const plain = await checkPublish(withJobs, { content, ...(shown && { shown }), media: [] }, [], site);
    expect(plain.leftOut).toBeUndefined();
    // A new pattern gives it the address of the page /about, which keeps it, so the item would go.
    const moved = [
      { path: "content/collections/jobs/_collection.json", content: JSON.stringify({ ...jobs, path: "/{slug}" }) },
    ];
    const checks = await checkPublish(withJobs, { content, ...(shown && { shown }), media: [] }, moved, site);
    expect(checks.leftOut).toEqual(["About the job"]);
  });

  it("knows the files a publish adds, and doesn't ask again about problems it didn't bring", async () => {
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
      { blocks: config.blocks, code: localSiteCode(config) },
    );
    expect(checks.blocking).toEqual([]);
    // The old page's link was already broken, so the publish that renames the page isn't stopped or asked about it.
    expect(checks.warnings.map((problem) => describeProblem(t, checks.content, problem))).toEqual([]);
  });
});
