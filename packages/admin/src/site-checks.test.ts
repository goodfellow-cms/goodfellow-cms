import {
  type CollectionFile,
  type CollectionSources,
  type ContentSource,
  collectionFileSchema,
  type GoodfellowConfig,
  loadSiteContent,
  SignInError,
  sourcedItemsFor,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { localSiteCode } from "./frame/local-code.js";
import { checkPublish, describeProblem, readShown, withProposedSettings } from "./site-checks.js";
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
    // Where the admin panel can't read the items, as on a static site, whose build does: links that could go to the
    // collection's pages, in any of the site's languages, aren't checked, and every other link still is.
    const unreachable = [
      ...linking,
      { path: "content/pages/other.json", content: page("Other", [button("Button-2", "/es/jobs/soldador")]) },
      { path: "content/pages/more.json", content: page("More", [button("Button-3", "/jobs/welder/more")]) },
      { path: "content/pages/careers.json", content: page("Careers", [button("Button-4", "/careers/welder")]) },
      // An item field naming one of its items, which the admin panel can't know it has.
      {
        path: "content/collections/news/_collection.json",
        content: JSON.stringify({
          version: 1,
          name: "News",
          entryName: "Story",
          fields: [
            { name: "title", label: "Title", type: "text" },
            { name: "job", label: "Job", type: "item", collection: "jobs" },
          ],
        }),
      },
      {
        path: "content/collections/news/hiring.json",
        content: JSON.stringify({ version: 1, fields: { title: "Hiring", job: "welder" } }),
      },
    ];
    const spanish: Record<string, string> = {
      ...files,
      "content/site.json": JSON.stringify({
        version: 1,
        title: "St. Joseph",
        languages: [{ code: "es", name: "Español" }],
      }),
      // A file the build's source replaces, which the checks leave unread here too.
      "content/collections/jobs/broken.json": JSON.stringify({ version: 1, fields: { title: 42 } }),
    };
    const inSpanish: ContentSource = {
      read: async (path) => spanish[path],
      list: async (dir) => Object.keys(spanish).filter((path) => path.startsWith(`${dir}/`)),
    };
    const loadedSpanish = await loadSiteContent(inSpanish, { sourced: ["jobs"] });
    const onStatic = await checkPublish(inSpanish, { content: loadedSpanish, media: [] }, unreachable, {
      blocks: config.blocks,
      code: localSiteCode(config),
      sourced: ["jobs"],
    });
    expect(onStatic.blocking.map((problem) => problem.kind === "missing-page" && problem.target).sort()).toEqual([
      "/careers/welder",
      "/jobs/welder/more",
    ]);
    // A new address pattern, which the settings screen refuses there, would leave links at the old one, which the
    // checks then count as missing, since they no longer fit the collection's pattern.
    const moved = [
      ...linking,
      {
        path: "content/collections/jobs/_collection.json",
        content: JSON.stringify({
          ...JSON.parse(files["content/collections/jobs/_collection.json"] ?? "{}"),
          path: "/careers/{slug}",
        }),
      },
    ];
    const onStaticMoved = await checkPublish(inSpanish, { content: loadedSpanish, media: [] }, moved, {
      blocks: config.blocks,
      code: localSiteCode(config),
      sourced: ["jobs"],
    });
    expect(onStaticMoved.blocking.map((problem) => problem.kind === "missing-page" && problem.target)).toEqual([
      "/jobs/welder",
    ]);
  });

  it("names the items a publish would take off the site, and never reads the files their source replaces", async () => {
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
    // Which the editor can publish anyway, since only the other system can change the item, with the site's other
    // checks made as for any publish.
    expect(checks.blocking).toEqual([]);
    const linking = [...moved, { path: "content/pages/new.json", content: page("New", [button("Button-1", "/gone")]) }];
    const broken = await checkPublish(withJobs, { content, ...(shown && { shown }), media: [] }, linking, site);
    expect(broken.leftOut).toEqual(["About the job"]);
    expect(broken.blocking.map((problem) => problem.kind)).toEqual(["missing-page"]);
  });

  it("asks a source with the settings a publish gives its collection, so a new field's values are checked", async () => {
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
    };
    const withJobs: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    // As the server answers: only the fields the settings it's given name.
    const rows = [{ slug: "welder", fields: { title: "Welder", pay: "a lot" } }];
    const read = async (_id: string, settings: CollectionFile) => sourcedItemsFor("jobs", settings, rows);
    const published = collectionFileSchema.parse(jobs);
    const sources = { jobs: { items: () => read("jobs", published) } };
    const content = await loadSiteContent(withJobs, { sourced: ["jobs"] });
    const { shown } = await readShown(content, sources);
    const loadedJobs = { content, ...(shown && { shown }), media: [] };
    // A number field the source's rows hold words for: the item wouldn't fit once it's published.
    const withPay = [
      {
        path: "content/collections/jobs/_collection.json",
        content: JSON.stringify({ ...jobs, fields: [...jobs.fields, { name: "pay", label: "Pay", type: "number" }] }),
      },
    ];
    const checks = (asked: CollectionSources | undefined) =>
      checkPublish(withJobs, loadedJobs, withPay, {
        blocks: config.blocks,
        code: localSiteCode(config),
        sources: asked,
      });
    expect((await checks(withProposedSettings(sources, withPay, read))).leftOut).toEqual(["Welder"]);
    // Asked with the settings as they're published, the field's values never came, so nothing seemed amiss.
    expect((await checks(sources)).leftOut).toBeUndefined();
    // Other changes leave the sources as they are.
    expect(withProposedSettings(sources, [], read)?.jobs).toBe(sources.jobs);
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
