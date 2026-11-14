import {
  type CollectionFile,
  type ContentSource,
  collectionFileSchema,
  type GoodfellowConfig,
  loadSiteContent,
  SignInError,
  sourcedItemsFor,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";
import { localSiteCode } from "./frame/local-code.js";
import { askedWithSettings, checkPublish, describeProblem, readShown } from "./site-checks.js";
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
    const settings = (name: string, path: string) =>
      JSON.stringify({
        version: 1,
        name,
        entryName: name,
        path,
        fields: [{ name: "title", label: "Title", type: "text" }],
      });
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": settings("Jobs", "/jobs/{slug}"),
      "content/collections/events/_collection.json": settings("Events", "/events/{slug}"),
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
    // One source that's down leaves the others' items shown, and names only itself.
    const events = { items: async () => [{ slug: "fair", fields: { title: "Fair" } }] };
    const partly = await readShown(content, { ...failing(new Error("The database didn't answer.")), events });
    expect(partly.unreadSources).toEqual(["jobs"]);
    expect(partly.shown?.collections.find((one) => one.id === "events")?.entries.map((entry) => entry.slug)).toEqual([
      "fair",
    ]);
    expect(await readShown(content, failing(new Error("The database didn't answer.")))).toEqual({
      unreadSources: ["jobs"],
    });
    await expect(
      readShown(content, { ...failing(new SignInError("invalid", "Sign in again.")), events }),
    ).rejects.toBeInstanceOf(SignInError);
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
    // A source that can't be read just now stops a publish that changes its collection's settings, rather than pass
    // it unchecked, naming the collection...
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
    const settings = [
      {
        path: "content/collections/jobs/_collection.json",
        content: JSON.stringify({
          ...JSON.parse(files["content/collections/jobs/_collection.json"] ?? "{}"),
          name: "Work",
        }),
      },
    ];
    const unread = await checkPublish(withJobs, { content, media: [] }, settings, site);
    expect(unread.unread).toEqual(["jobs"]);
    expect(unread.blocking).toEqual([]);
    // ...while any other publish is checked as a static site's is: a link that could go to the collection's pages
    // is left alone, and any other broken link still stops it.
    const meanwhile = await checkPublish(withJobs, { content, media: [] }, linking, site);
    expect(meanwhile.unread).toBeUndefined();
    expect(meanwhile.blocking).toEqual([]);
    const broken = [{ path: "content/pages/new.json", content: page("New", [button("Button-1", "/gone")]) }];
    const stillChecked = await checkPublish(withJobs, { content, media: [] }, broken, site);
    expect(stillChecked.blocking.map((problem) => problem.kind)).toEqual(["missing-page"]);
    // Publishing again asks the source again.
    answering = true;
    const read = await checkPublish(withJobs, { content, media: [] }, settings, site);
    expect(read.unread).toBeUndefined();
    expect(read.blocking).toEqual([]);
    // A sign-in that ran out is for signing in again, whether reading the source or the site's own files finds it.
    const expired = () => Promise.reject(new SignInError("invalid", "Sign in again."));
    const signedOut = { ...site, sources: { jobs: { items: expired } } };
    await expect(checkPublish(withJobs, { content, media: [] }, linking, signedOut)).rejects.toBeInstanceOf(
      SignInError,
    );
    const unreadable = { read: expired, list: expired, readBytes: expired } as unknown as typeof withJobs;
    await expect(checkPublish(unreadable, { content, media: [] }, linking, site)).rejects.toBeInstanceOf(SignInError);
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

  it("reads again only the sources a publish could change, or that couldn't be read, each on its own", async () => {
    const settings = (name: string, path: string) => ({
      version: 1,
      name,
      entryName: name,
      path,
      fields: [{ name: "title", label: "Title", type: "text" }],
    });
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": JSON.stringify(settings("Jobs", "/jobs/{slug}")),
      "content/collections/events/_collection.json": JSON.stringify(settings("Events", "/events/{slug}")),
    };
    const withBoth: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    const asked = { jobs: 0, events: 0 };
    let jobsDown = false;
    const sources = {
      jobs: {
        items: async () => {
          asked.jobs++;
          if (jobsDown) throw new Error("The database didn't answer.");
          return [{ slug: "welder", fields: { title: "Welder" } }];
        },
      },
      events: {
        items: async () => {
          asked.events++;
          return [{ slug: "fair", fields: { title: "Fair" } }];
        },
      },
    };
    const site = { blocks: config.blocks, code: localSiteCode(config), sources };
    const content = await loadSiteContent(withBoth, { sourced: ["jobs", "events"] });
    const read = await readShown(content, sources);
    const loadedBoth = { content, ...read, media: [] };
    const linking = [
      {
        path: "content/pages/new.json",
        content: page("New", [button("Button-1", "/jobs/welder"), button("Button-2", "/events/fair")]),
      },
    ];
    const renamed = (id: "jobs" | "events") => [
      {
        path: `content/collections/${id}/_collection.json`,
        content: JSON.stringify(settings(id === "jobs" ? "Work" : "Dates", `/${id}/{slug}`)),
      },
    ];
    // A publish that changes no sourced collection's settings asks no source anything: the items read as the site
    // loaded are checked again, so links to their pages are still known.
    asked.jobs = 0;
    asked.events = 0;
    const plain = await checkPublish(withBoth, loadedBoth, linking, site);
    expect(plain.blocking).toEqual([]);
    expect(asked).toEqual({ jobs: 0, events: 0 });
    // One that changes a collection's settings asks only its source, for the site before and after.
    const events = await checkPublish(withBoth, loadedBoth, [...linking, ...renamed("events")], site);
    expect(events.unread).toBeUndefined();
    expect(events.blocking).toEqual([]);
    expect(asked).toEqual({ jobs: 0, events: 2 });
    // A source that couldn't be read as the site loaded is asked again, once; still down, it stops only a change to
    // its own collection's settings, and links that could go to its pages are left alone.
    jobsDown = true;
    const partly = await readShown(content, sources);
    expect(partly.unreadSources).toEqual(["jobs"]);
    const loadedPartly = { content, ...partly, media: [] };
    asked.jobs = 0;
    asked.events = 0;
    const meanwhile = await checkPublish(withBoth, loadedPartly, [...linking, ...renamed("events")], site);
    expect(meanwhile.unread).toBeUndefined();
    expect(meanwhile.blocking).toEqual([]);
    expect(asked).toEqual({ jobs: 1, events: 2 });
    const waiting = await checkPublish(withBoth, loadedPartly, renamed("jobs"), site);
    expect(waiting.unread).toEqual(["jobs"]);
    // Answering again, its items are read for the site before the publish too, so one the publish's new page takes
    // the address of is named as left out.
    jobsDown = false;
    const taking = [{ path: "content/pages/jobs/welder.json", content: page("Welder's page") }];
    expect((await checkPublish(withBoth, loadedPartly, taking, site)).leftOut).toEqual(["Welder"]);
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

  it("names no item the other system removed since the site loaded as one the publish leaves out", async () => {
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
    let rows = [
      { slug: "welder", fields: { title: "Welder" } },
      { slug: "nurse", fields: { title: "Nurse" } },
    ];
    const sources = { jobs: { items: async () => rows } };
    const content = await loadSiteContent(withJobs, { sourced: ["jobs"] });
    const { shown } = await readShown(content, sources);
    // The nurse's opening is filled, and taken out of the other system, after the site loaded.
    rows = rows.filter((row) => row.slug !== "nurse");
    const typo = [{ path: "content/pages/about.json", content: page("About us") }];
    const checks = await checkPublish(withJobs, { content, ...(shown && { shown }), media: [] }, typo, {
      blocks: config.blocks,
      code: localSiteCode(config),
      sources,
    });
    expect(checks.leftOut).toBeUndefined();
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
    // As the server answers: only the fields the settings it's given name, or, without any, those published.
    const rows = [{ slug: "welder", fields: { title: "Welder", pay: "a lot" } }];
    const published = collectionFileSchema.parse(jobs);
    const read = async (_id: string, settings?: CollectionFile) => sourcedItemsFor("jobs", settings ?? published, rows);
    const sources = { jobs: { items: () => read("jobs") } };
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
    const checks = (asked: Parameters<typeof checkPublish>[3]["sources"]) =>
      checkPublish(withJobs, loadedJobs, withPay, {
        blocks: config.blocks,
        code: localSiteCode(config),
        sources: asked,
      });
    expect((await checks(askedWithSettings(["jobs"], read, () => true))).leftOut).toEqual(["Welder"]);
    // Asked with the settings as they're published, the field's values never came, so nothing seemed amiss.
    expect((await checks(sources)).leftOut).toBeUndefined();
  });

  it("asks as published for someone who isn't an owner, whose changes to a collection's settings the server refuses", async () => {
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
    // As the server answers an editor: settings are owners' to send, so asking with them is refused.
    const asked: (CollectionFile | undefined)[] = [];
    const read = async (_id: string, settings?: CollectionFile) => {
      asked.push(settings);
      if (settings) throw new Error("owners-only");
      return [{ slug: "welder", fields: { title: "Welder" } }];
    };
    const sources = askedWithSettings(["jobs"], read, () => false);
    const content = await loadSiteContent(withJobs, { sourced: ["jobs"] });
    const { shown } = await readShown(content, sources);
    // A move whose relinking rewrites the collection's template: the checks still read the source, and the server
    // says why the publish can't go, rather than the checks taking the source for one that can't be read.
    const relinked = [
      {
        path: "content/collections/jobs/_collection.json",
        content: JSON.stringify({ ...jobs, path: "/work/{slug}" }),
      },
    ];
    const checks = await checkPublish(withJobs, { content, ...(shown && { shown }), media: [] }, relinked, {
      blocks: config.blocks,
      code: localSiteCode(config),
      sources,
    });
    expect(checks.unread).toBeUndefined();
    // Loading it, and the checks' reads of the site as it is and as the publish leaves it.
    expect(asked).toEqual([undefined, undefined, undefined]);
  });

  it("reads a draft's new collection with the draft's settings, which the server doesn't have yet", async () => {
    const collection = (name: string, path: string) => ({
      version: 1,
      name,
      entryName: name,
      path,
      fields: [{ name: "title", label: "Title", type: "text" }],
    });
    const files: Record<string, string> = {
      ...FILES,
      "content/collections/jobs/_collection.json": JSON.stringify(collection("Jobs", "/jobs/{slug}")),
      // Only in the draft: the server reads the settings as published, where it has none.
      "content/collections/events/_collection.json": JSON.stringify(collection("Events", "/events/{slug}")),
    };
    const draft: ContentSource = {
      read: async (path) => files[path],
      list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
    };
    const read = async (id: string, settings?: CollectionFile) => {
      if (id === "events" && !settings) throw new Error("not-found");
      return [{ slug: `${id}-one`, fields: { title: `One of the ${id}` } }];
    };
    const content = await loadSiteContent(draft, { sourced: ["jobs", "events"] });
    const { shown, unreadSources } = await readShown(
      content,
      askedWithSettings(["jobs", "events"], read, () => true),
    );
    expect(unreadSources).toBeUndefined();
    expect(shown?.collections.map((one) => [one.id, one.entries.map((entry) => entry.slug)])).toEqual(
      expect.arrayContaining([
        ["jobs", ["jobs-one"]],
        ["events", ["events-one"]],
      ]),
    );
  });

  it("logs nothing in the editor's browser for a source's items it leaves out", async () => {
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
    // An item whose name can't be an address, which loading leaves out.
    const sources = { jobs: { items: async () => [{ slug: "Not A Name", fields: { title: "Welder" } }] } };
    const content = await loadSiteContent(withJobs, { sourced: ["jobs"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await checkPublish(withJobs, { content, media: [] }, [], {
        blocks: config.blocks,
        code: localSiteCode(config),
        sources,
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
