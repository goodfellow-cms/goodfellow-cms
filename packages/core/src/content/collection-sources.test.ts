import { describe, expect, it, vi } from "vitest";
import {
  type CollectionSource,
  CollectionSourceError,
  checkSourceModules,
  collectionSource,
  collectionSources,
  defineCollectionSource,
  isSourcedItem,
  keptCollectionSources,
  loadReadableSources,
  loadSourcedContent,
  readSources,
  type SourcedItem,
  sourceChanges,
  sourcedItemsFor,
  takesAnyAddress,
  withSourcedCollections,
} from "./collection-sources.js";
import { ContentError, type ContentProblem } from "./errors.js";
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
  return loadSiteContent(siteFiles(settings, path));
}

function siteFiles(settings: Record<string, unknown> = {}, path = "/jobs/{slug}", more: Record<string, unknown> = {}) {
  return memorySource({
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
    ...more,
  });
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

  it("leaves out an item whose values JSON can't hold, keeping the rest", async () => {
    const problems: ContentProblem[] = [];
    const circular: Record<string, unknown> = { title: "Loops" };
    circular.self = circular;
    const items = [
      { slug: "big", fields: { title: "Big", posted: 1n } },
      { slug: "loops", fields: circular },
      welder,
    ] as unknown as SourcedItem[];
    const content = await withSourcedCollections(await site(), { jobs: jobsSource(items).source }, (problem) =>
      problems.push(problem),
    );
    expect(content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toEqual([
      "welder",
    ]);
    expect(problems).toEqual([
      { file: "source:jobs/big", message: expect.stringContaining("JSON") },
      { file: "source:jobs/loops", message: expect.stringContaining("JSON") },
    ]);
  });

  it("shows an item whose name a refused item had before it", async () => {
    const problems: ContentProblem[] = [];
    const items = [{ slug: "welder", fields: { title: 42 } }, welder] as SourcedItem[];
    const content = await withSourcedCollections(await site(), { jobs: jobsSource(items).source }, (problem) =>
      problems.push(problem),
    );
    expect(content.collections.find((one) => one.id === "jobs")?.entries[0]?.content.fields).toEqual(welder.fields);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).not.toContain("twice");
  });

  it("keeps only the values of the collection's own fields, so a row's other columns never reach pages", async () => {
    const row = { ...welder, fields: { ...welder.fields, applicant: "ann@example.org" } };
    const content = await withSourcedCollections(await site(), { jobs: jobsSource([row]).source });
    expect(content.collections.find((one) => one.id === "jobs")?.entries[0]?.content.fields).toEqual(welder.fields);
  });

  it("asks every source at once, checking their items in the collections' order", async () => {
    let newsAsked: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      newsAsked = resolve;
    });
    // The jobs source answers only once the news source has been asked, which reading them in turn never would.
    const jobs: CollectionSource = { items: () => asked.then(() => [welder]) };
    const news: CollectionSource = {
      items: async () => {
        newsAsked();
        return [{ slug: "hello", fields: { title: "Hello" } }];
      },
    };
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("read in turn")), 1000));
    const content = await Promise.race([withSourcedCollections(await site(), { jobs, news }), timeout]);
    expect(content.collections.map((one) => [one.id, one.entries.map((entry) => entry.slug)])).toEqual([
      ["jobs", ["welder"]],
      ["news", ["hello"]],
    ]);
  });

  it("fails without a source never read, but shows the items one gave last while it can't be read", async () => {
    let down = true;
    const jobs: CollectionSource = {
      items: async () => {
        if (down) throw new Error("The database didn't answer.");
        return [welder];
      },
    };
    let newsAsked = 0;
    const news: CollectionSource = {
      items: async () => {
        newsAsked++;
        return [{ slug: "hello", fields: { title: "Hello" } }];
      },
    };
    // Never read yet: the site fails, once every other source has been asked, rather than show no jobs.
    await expect(withSourcedCollections(await site(), { jobs, news }, () => {})).rejects.toThrow("didn't answer");
    expect(newsAsked).toBe(1);
    // Read once, then down again: the items it gave are shown, saying so, and the others' are read as they are now.
    down = false;
    await withSourcedCollections(await site(), { jobs, news }, () => {});
    down = true;
    const problems: ContentProblem[] = [];
    const content = await withSourcedCollections(await site(), { jobs, news }, (problem) => problems.push(problem));
    expect(content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toEqual([
      "welder",
    ]);
    expect(problems).toEqual([{ file: "source:jobs", message: expect.stringMatching(/couldn't be read/) }]);
    expect(newsAsked).toBe(3);
  });

  it("shows a collection called constructor's last items while its source is down", async () => {
    const files = siteFiles();
    // News's settings at an address of its own, so its item doesn't take news's.
    const settings = JSON.stringify({
      ...JSON.parse((await files.read("content/collections/news/_collection.json")) ?? "{}"),
      path: "/constructor/{slug}",
    });
    const named: ContentSource = {
      read: async (path) => (path === "content/collections/constructor/_collection.json" ? settings : files.read(path)),
      list: async (dir) => [
        ...(await files.list(dir)),
        ...(dir === "content/collections" ? ["content/collections/constructor/_collection.json"] : []),
      ],
    };
    let down = false;
    const jobs: CollectionSource = {
      items: async () => {
        if (down) throw new Error("Down.");
        return [{ slug: "hello", fields: { title: "Hello" } }];
      },
    };
    const content = await loadSiteContent(named);
    expect(content.collections.some((one) => one.id === "constructor")).toBe(true);
    await withSourcedCollections(content, { constructor: jobs }, () => {});
    down = true;
    const shown = await withSourcedCollections(content, { constructor: jobs }, () => {});
    expect(shown.collections.find((one) => one.id === "constructor")?.entries.map((entry) => entry.slug)).toEqual([
      "hello",
    ]);
  });

  it("reads an item as a file of this version, whatever the source calls a version", async () => {
    const content = await withSourcedCollections(await site(), {
      jobs: jobsSource([{ ...welder, version: 2 } as SourcedItem]).source,
    });
    expect(content.collections.find((one) => one.id === "jobs")?.entries[0]?.content.version).toBe(1);
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

describe("loadSiteContent with sourced collections", () => {
  it("reads their settings but not their item files, which their sources' items replace", async () => {
    // A file left in the folder that would take a page's address, and one that doesn't fit the fields.
    const files = siteFiles({}, "/jobs/{slug}", {
      "content/collections/jobs/apply.json": { version: 1, fields: { title: "Takes the page's address" } },
      "content/collections/jobs/broken.json": { version: 1, fields: { title: 42 } },
    });
    await expect(loadSiteContent(files)).rejects.toThrow(ContentError);
    const content = await loadSiteContent(files, { sourced: ["jobs"] });
    const jobs = content.collections.find((one) => one.id === "jobs");
    expect(jobs?.settings.name).toBe("Jobs");
    expect(jobs?.entries).toEqual([]);
    // Other collections' files are read as ever.
    expect(content.collections.find((one) => one.id === "news")?.entries.map((entry) => entry.slug)).toEqual(["hello"]);
    const sourced = await withSourcedCollections(content, { jobs: jobsSource([welder]).source });
    expect(allPages(sourced).map((one) => one.path)).toContain("/jobs/welder");
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

  it("makes one collection's source on its own, and none for a collection the config names no source for", () => {
    const failing = vi.fn((): CollectionSource => {
      throw new Error("NEWS_DATABASE_URL isn't set");
    });
    const config = {
      jobs: { source: "./lib/jobs.ts", options: { table: "openings" } },
      news: { source: "./lib/news.ts" },
    };
    const modules = { jobs: make, news: failing };
    expect(collectionSource(config, modules, "jobs")).toBeDefined();
    expect(failing).not.toHaveBeenCalled();
    expect(collectionSource(config, modules, "events")).toBeUndefined();
    expect(collectionSource(config, modules, "constructor")).toBeUndefined();
    expect(() => collectionSource(config, modules, "news")).toThrow("NEWS_DATABASE_URL");
    expect(() => collectionSource(config, {}, "jobs")).toThrow(CollectionSourceError);
  });

  it("checks the modules without making any source", () => {
    const make = vi.fn(() => ({ items: async () => [] }));
    const config = { jobs: { source: "./lib/jobs.ts" } };
    checkSourceModules(config, { jobs: make });
    expect(make).not.toHaveBeenCalled();
    expect(() => checkSourceModules(config, {})).toThrow(CollectionSourceError);
    expect(() => checkSourceModules(undefined, { jobs: make })).toThrow(CollectionSourceError);
  });

  it("reads only the modules given and the collections named, whatever a collection is called", async () => {
    // A collection called `constructor` with no module given, and a module given for one the config doesn't name.
    const config = { constructor: { source: "./lib/constructor.ts" } };
    expect(() => checkSourceModules(config, {})).toThrow(CollectionSourceError);
    expect(() => collectionSources(config, {})).toThrow(CollectionSourceError);
    expect(() => keptCollectionSources(config, {})).toThrow(CollectionSourceError);
    expect(() => collectionSource(config, {}, "constructor")).toThrow(CollectionSourceError);
    expect(() => checkSourceModules({}, { constructor: make })).toThrow(CollectionSourceError);
    // Given, it's made like any other.
    const made = collectionSources(config, { constructor: make });
    expect(Object.hasOwn(made, "constructor")).toBe(true);
    expect(await (made.constructor as unknown as CollectionSource).items()).toHaveLength(1);
  });
});

describe("loadSourcedContent", () => {
  it("loads the files without the item files the sources replace, then reads the sources in", async () => {
    const content = await loadSourcedContent(
      siteFiles({}, "/jobs/{slug}", { "content/collections/jobs/bad.json": { version: 1, fields: { title: 42 } } }),
      {
        jobs: jobsSource([welder]).source,
      },
    );
    expect(content.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toEqual([
      "welder",
    ]);
  });
});

describe("keptCollectionSources", () => {
  it("makes each source once for the same module and options, and again for a new module or new options", () => {
    const make = vi.fn(() => jobsSource([welder]).source);
    const module = { default: make };
    const config = { jobs: { source: "./lib/jobs.ts", options: { table: "jobs" } } };
    const first = keptCollectionSources(config, { jobs: module });
    expect(keptCollectionSources(config, { jobs: module }).jobs).toBe(first.jobs);
    expect(make).toHaveBeenCalledOnce();
    keptCollectionSources({ jobs: { ...config.jobs, options: { table: "roles" } } }, { jobs: module });
    // Only the latest options' source is kept, so going back makes it again, and the one before can be let go.
    keptCollectionSources(config, { jobs: module });
    expect(make).toHaveBeenCalledTimes(3);
    keptCollectionSources(config, { jobs: { default: make } });
    expect(make).toHaveBeenCalledTimes(4);
    expect(() => keptCollectionSources(config, {})).toThrow(CollectionSourceError);
  });

  it("closes the source it made before, once it makes another in its place, and only then", async () => {
    const closed: string[] = [];
    const made = (name: string): CollectionSource => ({
      items: async () => [],
      close: () => {
        closed.push(name);
      },
    });
    const config = { jobs: { source: "./lib/jobs.ts", options: { table: "jobs" } } };
    const first = { default: () => made("first") };
    keptCollectionSources(config, { jobs: first });
    keptCollectionSources(config, { jobs: first });
    await Promise.resolve();
    expect(closed).toEqual([]);
    // The module changed, as when its file is edited: a new pool in place of the one before.
    keptCollectionSources(config, { jobs: { default: () => made("second") } });
    // New options, which make it again too.
    keptCollectionSources(
      { jobs: { ...config.jobs, options: { table: "roles" } } },
      { jobs: { default: () => made("third") } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toEqual(["first", "second"]);
    // One that fails to close is only warned about.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failing = {
        default: (): CollectionSource => ({
          items: async () => [],
          close: () => Promise.reject(new Error("Pool gone.")),
        }),
      };
      keptCollectionSources(config, { jobs: failing });
      keptCollectionSources(config, { jobs: { default: () => made("fifth") } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(warn).toHaveBeenCalledWith("source:jobs couldn't be closed: Pool gone.");
    } finally {
      warn.mockRestore();
    }
  });

  it("never closes another site's source, as two sites in one process have their own", async () => {
    const closed: string[] = [];
    const made = (name: string) => ({
      default: (): CollectionSource => ({
        items: async () => [],
        close: () => {
          closed.push(name);
        },
      }),
    });
    const config = { jobs: { source: "./lib/jobs.ts" } };
    const one = made("one");
    const first = keptCollectionSources(config, { jobs: one }, "/sites/one").jobs;
    keptCollectionSources(config, { jobs: made("two") }, "/sites/two");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toEqual([]);
    expect(keptCollectionSources(config, { jobs: one }, "/sites/one").jobs).toBe(first);
  });

  it("never gives out a source it closed, as when the module changes and changes back", () => {
    const config = { jobs: { source: "./lib/jobs.ts", options: { table: "jobs" } } };
    const made: CollectionSource[] = [];
    const module = {
      default: (): CollectionSource => {
        const source = { items: async () => [], close: () => {} };
        made.push(source);
        return source;
      },
    };
    const first = keptCollectionSources(config, { jobs: module }).jobs;
    keptCollectionSources(config, { jobs: { default: () => ({ items: async () => [] }) } });
    // Back to the first module, with the same options: its source was closed, so another is made.
    const again = keptCollectionSources(config, { jobs: module }).jobs;
    expect(again).not.toBe(first);
    expect(made).toHaveLength(2);
    // And that one is kept while nothing changes.
    expect(keptCollectionSources(config, { jobs: module }).jobs).toBe(again);
  });
});

describe("sourceChanges", () => {
  it("asks every source at once", async () => {
    let newsAsked: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      newsAsked = resolve;
    });
    const jobs: CollectionSource = {
      items: async () => [],
      changed: () => asked.then(() => ({ slugs: [], next: "j" })),
    };
    const news: CollectionSource = {
      items: async () => [],
      changed: async () => {
        newsAsked();
        return { slugs: [], next: "n" };
      },
    };
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("asked in turn")), 1000));
    const changes = await Promise.race([sourceChanges(await site(), { jobs, news }), timeout]);
    expect(changes.next).toEqual({ jobs: "j", news: "n" });
  });

  it("names the collections that changed and the pages of their items, and what to ask from next time", async () => {
    const jobs = jobsSource([welder, baker]);
    const plain: CollectionSource = { items: async () => [] };
    const before = await withSourcedCollections(await site(), { jobs: jobs.source });
    expect(await sourceChanges(before, { jobs: jobs.source, news: plain })).toEqual({
      collections: [],
      paths: [],
      next: { jobs: "1" },
      failed: [],
    });
    jobs.set([welder, baker], ["welder", "gone", "Not A Name"]);
    const after = await withSourcedCollections(await site(), { jobs: jobs.source });
    // A removed item's page too, which a site keeping pages once they've rendered would otherwise go on showing.
    expect(await sourceChanges(after, { jobs: jobs.source })).toEqual({
      collections: ["jobs"],
      paths: ["/jobs/gone", "/jobs/welder"],
      next: { jobs: "1" },
      failed: [],
    });
    // In each of the site's languages, since a removed item's language isn't known.
    const spanish = await withSourcedCollections(await site({ languages: [{ code: "es", name: "Español" }] }), {
      jobs: jobs.source,
    });
    expect((await sourceChanges(spanish, { jobs: jobs.source })).paths).toEqual([
      "/es/jobs/gone",
      "/es/jobs/welder",
      "/jobs/gone",
      "/jobs/welder",
    ]);
    // An item moved to another language: its page there, and the one it had before.
    const moved = jobsSource([{ ...welder, inLanguage: "es" }, baker]);
    moved.set([{ ...welder, inLanguage: "es" }, baker], ["welder"]);
    const movedSite = await withSourcedCollections(await site({ languages: [{ code: "es", name: "Español" }] }), {
      jobs: moved.source,
    });
    expect((await sourceChanges(movedSite, { jobs: moved.source })).paths).toEqual(["/es/jobs/welder", "/jobs/welder"]);
    expect(await sourceChanges(after, { jobs: jobs.source }, { jobs: "1" })).toEqual({
      collections: [],
      paths: [],
      next: { jobs: "1" },
      failed: [],
    });
  });

  it("lets go of a removed source's place, and keeps a failing one's without stopping the rest", async () => {
    const jobs = jobsSource([welder]);
    jobs.set([welder], ["welder"]);
    const failing: CollectionSource = {
      items: async () => [],
      changed: async () => {
        throw new Error("The news API didn't answer.");
      },
    };
    const content = await withSourcedCollections(await site(), { jobs: jobs.source });
    const changes = await sourceChanges(
      content,
      { jobs: jobs.source, news: failing },
      { jobs: "0", news: "7", gone: "3" },
    );
    // Jobs' changes come through, news keeps where it was to ask from again, and the removed source's place goes.
    expect(changes.collections).toEqual(["jobs"]);
    expect(changes.paths).toEqual(["/jobs/welder"]);
    expect(changes.next).toEqual({ jobs: "1", news: "7" });
    expect(changes.failed).toEqual(["news"]);
  });

  it("names a source that throws before answering, or answers in another shape, as failed, keeping the others'", async () => {
    const jobs = jobsSource([welder]);
    jobs.set([welder], ["welder"]);
    const throwing: CollectionSource = {
      items: async () => [],
      changed: () => {
        throw new Error("Thrown at once.");
      },
    };
    const odd = { items: async () => [], changed: async () => ({ next: "9" }) } as unknown as CollectionSource;
    const notNames = {
      items: async () => [],
      changed: async () => ({ slugs: [1], next: "9" }),
    } as unknown as CollectionSource;
    const content = await withSourcedCollections(await site(), { jobs: jobs.source });
    const changes = await sourceChanges(content, { jobs: jobs.source, news: throwing, odd, notNames }, { news: "7" });
    expect(changes.paths).toEqual(["/jobs/welder"]);
    expect(changes.next).toEqual({ jobs: "1", news: "7" });
    expect(changes.failed).toEqual(["news", "odd", "notNames"]);
  });

  it("asks a source called constructor from the start, not from what objects have of their own", async () => {
    const asked: unknown[] = [];
    const named: CollectionSource = {
      items: async () => [],
      changed: async (since) => {
        asked.push(since);
        return { slugs: [], next: "1" };
      },
    };
    await sourceChanges(await site(), { constructor: named });
    expect(asked).toEqual([""]);
  });

  it("names no collection the site has no settings for, which has no pages", async () => {
    const events: CollectionSource = { items: async () => [], changed: async () => ({ slugs: ["fair"], next: "2" }) };
    expect(await sourceChanges(await site(), { events })).toEqual({
      collections: [],
      paths: [],
      next: { events: "2" },
      failed: [],
    });
  });
});

describe("sourcedItemsFor", () => {
  it("gives the items a file could hold, each name once, with only the collection's own fields", async () => {
    const settings = (await site()).collections.find((one) => one.id === "jobs")?.settings;
    if (!settings) throw new Error("no jobs");
    const items = [
      { slug: "welder", fields: { title: 42 } },
      { ...welder, fields: { ...welder.fields, applicant: "ann@example.org" }, showFrom: "2026-11-01T09:00" },
      { slug: "welder", fields: { title: "Twice" } },
      { slug: "Not A Name", fields: { title: "Bad" } },
      { slug: "big", fields: { title: "Big", posted: 1n } },
    ] as unknown as SourcedItem[];
    expect(sourcedItemsFor("jobs", settings, items)).toEqual([{ ...welder, showFrom: "2026-11-01T09:00" }]);
  });

  it("keeps only a group's own fields in its rows", async () => {
    const settings = (await site()).collections.find((one) => one.id === "jobs")?.settings;
    if (!settings) throw new Error("no jobs");
    const contacts = { name: "contacts", label: "Contacts", type: "group", fields: [field("name", "text")] };
    const withGroup = { ...settings, fields: [...settings.fields, contacts] } as typeof settings;
    const item = { ...welder, fields: { ...welder.fields, contacts: [{ name: "Ann", email: "ann@example.org" }] } };
    expect(sourcedItemsFor("jobs", withGroup, [item])).toEqual([
      { ...welder, fields: { ...welder.fields, contacts: [{ name: "Ann" }] } },
    ]);
  });
});

describe("readSources", () => {
  it("reads each source on its own, so one that throws before answering fails only itself", async () => {
    const jobs: CollectionSource = {
      items: () => {
        throw new Error("Thrown at once.");
      },
    };
    const news: CollectionSource = { items: async () => [{ slug: "hello", fields: { title: "Hello" } }] };
    const { read, failed, errors } = await readSources({ jobs, news });
    expect(Object.keys(read)).toEqual(["news"]);
    expect(failed).toEqual(["jobs"]);
    expect(errors).toEqual([new Error("Thrown at once.")]);
  });

  it("takes a source that gave something other than a list of items as failed, saying so", async () => {
    for (const value of [undefined, { rows: [] }]) {
      const jobs = { items: async () => value } as unknown as CollectionSource;
      const { read, failed, errors } = await readSources({ jobs });
      expect(read).toEqual({});
      expect(failed).toEqual(["jobs"]);
      expect(errors[0]).toBeInstanceOf(CollectionSourceError);
      expect((errors[0] as Error).message).toBe('The source of the collection "jobs" didn\'t give a list of items.');
    }
  });
});

describe("loadReadableSources", () => {
  it("shows the items of the sources it can read, leaving the others' collections empty and naming them", async () => {
    // Jobs' folder still has an item file, which is never read.
    const files = siteFiles();
    const down = new Error("No database here.");
    const { content, failed, errors } = await loadReadableSources(files, {
      jobs: { items: async () => Promise.reject(down) },
      news: { items: async () => [{ slug: "hello", fields: { title: "Hello" } }] },
    });
    expect(failed).toEqual(["jobs"]);
    expect(errors).toEqual([down]);
    const entries = (id: string) => content.collections.find((one) => one.id === id)?.entries.map((e) => e.slug);
    expect(entries("news")).toEqual(["hello"]);
    expect(entries("jobs")).toEqual([]);
  });
});

describe("takesAnyAddress", () => {
  it("is a pattern of only the item's name, which every address of one part matches", () => {
    expect(takesAnyAddress({ path: "/{slug}" })).toBe(true);
    expect(takesAnyAddress({ path: "{slug}/" })).toBe(true);
    for (const path of ["/jobs/{slug}", "/{slug}/apply", undefined, "/"]) expect(takesAnyAddress({ path })).toBe(false);
  });
});
