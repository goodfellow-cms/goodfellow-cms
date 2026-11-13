import { describe, expect, it, vi } from "vitest";
import {
  type CollectionSource,
  CollectionSourceError,
  collectionSources,
  defineCollectionSource,
  isSourcedItem,
  type SourcedItem,
  sourceChanges,
  withSourcedCollections,
} from "./collection-sources.js";
import type { ContentProblem } from "./errors.js";
import { feedFiles } from "./feeds.js";
import { allPages, type ContentSource, loadSiteContent } from "./load.js";
import { shownContent } from "./schedule.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)]));
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const field = (name: string, type: string) => ({ name, label: name, type });
const page = (title: string) => ({ version: 1, data: { root: { props: { title } }, content: [] } });

/** A site with a jobs collection, whose own folder still has an item file, and a page at /jobs/apply. */
function site(settings: Record<string, unknown> = {}, path = "/jobs/{slug}") {
  return loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, url: "https://example.org", ...settings },
      "content/pages/index.json": page("Home"),
      "content/pages/jobs/apply.json": page("How to apply"),
      "content/collections/jobs/_collection.json": {
        version: 1,
        name: "Jobs",
        entryName: "Job",
        path,
        sort: { field: "posted", order: "desc" },
        fields: [field("title", "text"), field("posted", "date"), field("about", "richtext")],
      },
      "content/collections/jobs/old-file.json": { version: 1, fields: { title: "From a file", posted: "2026-01-01" } },
      "content/collections/news/_collection.json": {
        version: 1,
        name: "News",
        entryName: "Story",
        path: "/news/{slug}",
        fields: [field("title", "text")],
      },
      "content/collections/news/hello.json": { version: 1, fields: { title: "Hello" } },
    }),
  );
}

/** A source of the tests' own, as a site's database would be, which can be changed between reads. */
function jobsSource(items: SourcedItem[]) {
  let rows = items;
  let changes: string[] = [];
  const source: CollectionSource = {
    items: async () => rows,
    changed: async (since) => ({ slugs: since === "1" ? [] : changes, next: "1" }),
  };
  return {
    source,
    set(next: SourcedItem[], changed: string[]) {
      rows = next;
      changes = changed;
    },
  };
}

const welder = { slug: "welder", fields: { title: "Welder", posted: "2026-11-02", about: "<p>Hot work.</p>" } };
const baker = { slug: "baker", fields: { title: "Baker", posted: "2026-11-09" } };

describe("withSourcedCollections", () => {
  it("gives a collection its source's items in place of its files, as entries with pages, in its order", async () => {
    const content = await withSourcedCollections(await site(), { jobs: jobsSource([welder, baker]).source });
    const jobs = content.collections.find((one) => one.id === "jobs");
    expect(jobs?.sourced).toBe(true);
    expect(jobs?.entries.map((entry) => [entry.slug, entry.path, entry.file])).toEqual([
      ["baker", "/jobs/baker", "source:jobs/baker"],
      ["welder", "/jobs/welder", "source:jobs/welder"],
    ]);
    expect(jobs?.entries.every(isSourcedItem)).toBe(true);
    expect(jobs?.entries[1]?.content).toEqual({ version: 1, fields: welder.fields });
    expect(allPages(content).map((one) => one.path)).toEqual([
      "/",
      "/jobs/apply",
      "/jobs/baker",
      "/jobs/welder",
      "/news/hello",
    ]);
    // Other collections are as their files say.
    expect(content.collections.find((one) => one.id === "news")?.sourced).toBeUndefined();
  });

  it("leaves out items a file couldn't hold, or that take an address the site has, saying why", async () => {
    const problems: ContentProblem[] = [];
    const items = [
      welder,
      { slug: "Not A Name", fields: { title: "Bad name" } },
      { slug: "welder", fields: { title: "Twice" } },
      { slug: "typist", fields: { title: "Typist", posted: "yesterday" } },
      { slug: "apply", fields: { title: "Takes a page's address" } },
      { slug: "admin-ish", fields: { title: "In another language" }, inLanguage: "fr" },
      { slug: "nameless", fields: { title: 42 } },
    ] as SourcedItem[];
    const content = await withSourcedCollections(await site(), { jobs: jobsSource(items).source }, (problem) =>
      problems.push(problem),
    );
    expect(content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toEqual([
      "welder",
    ]);
    expect(problems.map((problem) => problem.file)).toEqual([
      "source:jobs/Not A Name",
      "source:jobs/welder",
      "source:jobs/typist",
      "source:jobs/apply",
      "source:jobs/admin-ish",
      "source:jobs/nameless",
    ]);
    expect(problems[1]?.message).toContain("twice");
    expect(problems[3]?.message).toContain("content/pages/jobs/apply.json");
    expect(problems[4]?.message).toContain("fr");
  });

  it("leaves out an item whose address is the admin panel's", async () => {
    const problems: ContentProblem[] = [];
    const content = await withSourcedCollections(
      await site({}, "/{slug}"),
      { jobs: jobsSource([welder, { slug: "admin", fields: { title: "Admin" } }]).source },
      (problem) => problems.push(problem),
    );
    expect(content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.path)).toEqual([
      "/welder",
    ]);
    expect(problems.map((problem) => problem.message)).toEqual([expect.stringContaining("reserved")]);
  });

  it("reports problems as warnings by default, and leaves a site without the collection as it is", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withSourcedCollections(await site(), { jobs: jobsSource([{ slug: "x", fields: { title: 1 } }]).source });
      expect(warn).toHaveBeenCalledOnce();
      const before = await site();
      expect(await withSourcedCollections(before, { events: jobsSource([welder]).source })).toBe(before);
    } finally {
      warn.mockRestore();
    }
  });

  it("gives items in the site's other languages their language's addresses", async () => {
    const content = await withSourcedCollections(await site({ languages: [{ code: "es", name: "Español" }] }), {
      jobs: jobsSource([welder, { ...baker, slug: "panadero", inLanguage: "es", translationOf: "baker" }]).source,
    });
    const paths = content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.path);
    expect(paths).toEqual(["/es/jobs/panadero", "/jobs/welder"]);
  });

  it("feeds what the source gives, with schedules applied as files' are", async () => {
    const later = { slug: "later", fields: { title: "Later", posted: "2026-11-10" }, showFrom: "2999-01-01T00:00" };
    const content = shownContent(
      await withSourcedCollections(await site(), { jobs: jobsSource([welder, baker, later]).source }),
    );
    expect(allPages(content).map((one) => one.path)).not.toContain("/jobs/later");
    const rss = feedFiles(content).find((file) => file.path.endsWith("jobs.rss"));
    expect(rss?.content).toContain("https://example.org/jobs/baker/");
    expect(rss?.content).toContain("Welder");
    expect(rss?.content).not.toContain("From a file");
    expect(rss?.content).not.toContain("Later");
  });
});

describe("collectionSources", () => {
  const make = defineCollectionSource<{ table: string }>((options) => ({
    items: async () => [{ slug: options.table, fields: { title: options.table } }],
  }));

  it("makes each collection's source from the module the server imported and the config's options", async () => {
    const sources = collectionSources(
      { jobs: { source: "./lib/jobs.ts", options: { table: "openings" } } },
      { jobs: { default: make } },
    );
    expect(await sources.jobs?.items()).toEqual([{ slug: "openings", fields: { title: "openings" } }]);
    const bare = collectionSources({ jobs: { source: "./lib/jobs.ts", options: { table: "x" } } }, { jobs: make });
    expect(await bare.jobs?.items()).toHaveLength(1);
  });

  it("refuses a collection the server wasn't given a module for, and a module for no collection", () => {
    expect(() => collectionSources({ jobs: { source: "./lib/jobs.ts" } }, {})).toThrow(CollectionSourceError);
    expect(() => collectionSources({ jobs: { source: "./lib/jobs.ts" } }, {})).toThrow(/lib\/jobs\.ts/);
    expect(() => collectionSources(undefined, { jobs: make })).toThrow(CollectionSourceError);
    expect(collectionSources(undefined, {})).toEqual({});
  });
});

describe("sourceChanges", () => {
  it("names the collections that changed and the pages of their items, and what to ask from next time", async () => {
    const jobs = jobsSource([welder, baker]);
    const plain: CollectionSource = { items: async () => [] };
    const before = await withSourcedCollections(await site(), { jobs: jobs.source });
    expect(await sourceChanges(before, { jobs: jobs.source, news: plain })).toEqual({
      collections: [],
      paths: [],
      next: { jobs: "1" },
    });
    jobs.set([welder, baker], ["welder", "gone"]);
    const after = await withSourcedCollections(await site(), { jobs: jobs.source });
    expect(await sourceChanges(after, { jobs: jobs.source })).toEqual({
      collections: ["jobs"],
      paths: ["/jobs/welder"],
      next: { jobs: "1" },
    });
    expect(await sourceChanges(after, { jobs: jobs.source }, { jobs: "1" })).toEqual({
      collections: [],
      paths: [],
      next: { jobs: "1" },
    });
  });
});
