import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blocks } from "@goodfellow-cms/blocks";
import type { StorageLike } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { describeSite } from "@goodfellow-cms/react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createGoodfellowServer, type Screenshotter } from "./index.js";

const starter = resolve(import.meta.dirname, "../../../templates/starter");

/** The starter's content, at the address https://parish.example. */
function starterFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(join(starter, "content"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name)
      .slice(starter.length + 1)
      .split("\\")
      .join("/");
    files[path] = readFileSync(join(starter, path), "utf8");
  }
  const site = JSON.parse(files["content/site.json"] ?? "{}");
  files["content/site.json"] = `${JSON.stringify({ ...site, url: "https://parish.example" }, null, 2)}\n`;
  files["public/media/photo.jpg"] = "not really a photo";
  return files;
}

function memoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

async function connect(
  options: { description?: unknown; screenshots?: Screenshotter; files?: Record<string, string> } = {},
) {
  const fake = fakeGitHub({ repo: "parish/site", files: options.files ?? starterFiles() });
  const host = github({
    repo: "parish/site",
    signIn: false,
    fetch: fake.fetch,
    storage: { local: memoryStorage(), session: memoryStorage() },
  });
  const description = options.description ?? describeSite({ blocks });
  const server = createGoodfellowServer({
    sites: async () => [{ id: "github:parish/site", label: "St. Joseph" }],
    backend: async () => host.signInWithToken("test-token", false),
    fetch: async (input) =>
      String(input) === "https://parish.example/goodfellow-site.json"
        ? Response.json(description)
        : new Response("Not found", { status: 404 }),
    ...(options.screenshots && { screenshots: options.screenshots }),
    now: () => new Date("2026-10-14T12:00:00Z"),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
    const [first] = result.content;
    return {
      isError: result.isError === true,
      text: first?.text ?? "",
      json: () => JSON.parse(first?.text ?? "null"),
      content: result.content,
    };
  }
  return { fake, client, call };
}

const heading = (text: string) => ({
  type: "Heading",
  id: "b1",
  parent: null,
  slot: null,
  props: { text, level: "h1", align: "left" },
});

describe("reading a site", () => {
  it("tells Claude how to work with Goodfellow sites", async () => {
    const { client } = await connect();
    expect(client.getInstructions()).toContain("draft");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["get_site", "save_page", "publish", "submit_for_review"]),
    );
    // No screenshots where the server can't take them.
    expect(tools.map((tool) => tool.name)).not.toContain("screenshot");
  });

  it("gives an overview of the site, then a page's blocks", async () => {
    const { call } = await connect();
    const site = (await call("get_site")).json();
    expect(site).toMatchObject({ site: "github:parish/site", address: "https://parish.example" });
    expect(site.pages).toEqual(["/", "/404", "/about", "/news"]);
    expect(site.collections).toEqual([{ id: "news", entries: 2 }]);
    expect(site.blocks).toEqual(expect.arrayContaining([{ name: "Heading", label: "Heading" }]));

    const about = (await call("get_page", { address: "about" })).json();
    expect(about.address).toBe("/about");
    expect(about.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "Heading", props: expect.objectContaining({ text: "About us" }) }),
      ]),
    );
    expect((await call("get_page", { address: "/nowhere" })).text).toContain("no page at /nowhere");
  });

  it("describes the site's blocks and their props", async () => {
    const { call } = await connect();
    const { blocks: described } = (await call("get_blocks", { names: ["Section"] })).json();
    expect(described).toEqual([
      expect.objectContaining({
        name: "Section",
        slots: ["content"],
        props: expect.objectContaining({ type: "object" }),
      }),
    ]);
  });

  it("reads collections and their items", async () => {
    const { call } = await connect();
    const news = (await call("get_collection", { collection: "news" })).json();
    expect(news).toMatchObject({ name: "News", address: "/news/{slug}" });
    expect(news.items).toEqual(expect.arrayContaining([{ slug: "welcome", address: "/news/welcome" }]));
    const item = (await call("get_item", { collection: "news", slug: "welcome" })).json();
    expect(item.values.title).toBe("Welcome to our new website");
    expect((await call("list_media")).json()).toContainEqual({ address: "/media/photo.jpg", bytes: 18 });
  });

  it("lists media with the credits pages show for them", async () => {
    const files = starterFiles();
    files["public/media/choir.jpg"] = "a photo of a choir";
    files["content/media.json"] = `${JSON.stringify({
      version: 1,
      credits: { "/media/choir.jpg": { title: "Choir", creator: "A. Singer", license: "CC BY 2.0" } },
    })}\n`;
    const { call } = await connect({ files });
    expect((await call("list_media")).json()).toEqual([
      {
        address: "/media/choir.jpg",
        bytes: 18,
        credit: { title: "Choir", creator: "A. Singer", source: "", license: "CC BY 2.0" },
      },
      { address: "/media/photo.jpg", bytes: 18 },
    ]);
  });

  it("explains when the site's description can't be read", async () => {
    const { call } = await connect({ description: "<!doctype html>" });
    const result = await call("get_site");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("couldn't read what blocks the site has");
  });
});

describe("changing a site", () => {
  it("keeps changes in a draft until they're published, in one go", async () => {
    const { call, fake } = await connect();
    const saved = (await call("save_page", { address: "/about", blocks: [heading("About St. Joseph")] })).json();
    expect(saved).toMatchObject({ draft: expect.stringMatching(/^20261014-[a-z0-9]{6}$/), saved: "changed" });
    const { draft } = saved;

    // The live site is as it was; the draft has the change.
    expect((await call("get_page", { address: "/about" })).text).toContain("About us");
    expect((await call("get_page", { address: "/about", draft })).json().blocks).toEqual([
      expect.objectContaining({ type: "Heading", props: expect.objectContaining({ text: "About St. Joseph" }) }),
    ]);

    // More changes go in the same draft.
    await call("save_page", {
      address: "/summer-fair",
      draft,
      settings: { title: "Summer fair" },
      blocks: [heading("Summer fair")],
    });
    await call("save_item", {
      collection: "news",
      slug: "fair",
      draft,
      values: { title: "Fair news", date: "2026-07-01" },
    });
    expect((await call("get_draft", { draft })).json().changes).toEqual([
      { file: "content/collections/news/fair.json", changed: true },
      { page: "/about", changed: true },
      { page: "/summer-fair", changed: true },
    ]);

    const head = fake.repo.head();
    expect((await call("publish", { draft, message: "New summer fair page" })).json()).toMatchObject({
      published: true,
    });
    expect(fake.repo.commitAt(fake.repo.head())?.parent).toBe(head);
    expect(fake.repo.commitAt(fake.repo.head())?.message).toBe("New summer fair page");
    expect(fake.repo.files().get("content/pages/summer-fair.json")).toContain('"title": "Summer fair"');
    expect(fake.repo.files().get("content/collections/news/fair.json")).toContain('"title": "Fair news"');
    expect([...fake.repo.branches.keys()]).toEqual(["main"]);
    expect((await call("get_draft", { draft })).text).toContain("isn't there any more");
  });

  it("saves only blocks the site has, and says what it left out", async () => {
    const { call, fake } = await connect();
    const saved = (
      await call("save_page", {
        address: "/about",
        blocks: [heading("Kept"), { type: "Carousel", id: "b2", parent: null, slot: null, props: {} }],
      })
    ).json();
    expect(saved.ignored).toContain("1 block(s) weren't saved");
    const file = fake.repo.files(`goodfellow-draft-${saved.draft}`).get("content/pages/about.json");
    expect(file).toContain('"text": "Kept"');
    expect(file).not.toContain("Carousel");
  });

  it("refuses addresses pages can't have", async () => {
    const { call } = await connect();
    expect((await call("save_page", { address: "/news/welcome", blocks: [] })).text).toContain(
      "already a collection item's address",
    );
    expect((await call("save_page", { address: "/admin", blocks: [] })).text).toContain("kept for the admin panel");
    expect((await call("save_page", { address: "/About Us!", blocks: [] })).text).toContain(
      "can't be a page's address",
    );
    expect((await call("delete_page", { address: "/" })).text).toContain("home page can't be deleted");
  });

  it("checks items' values against their collection's fields", async () => {
    const { call } = await connect();
    expect((await call("save_item", { collection: "news", slug: "x", values: { colour: "red" } })).text).toContain(
      "no field colour",
    );
    expect((await call("save_item", { collection: "news", slug: "x", values: { title: "No date" } })).text).toContain(
      "needs a value for: date",
    );
    expect(
      (await call("save_item", { collection: "news", slug: "x", values: { title: "Bad date", date: "soon" } })).text,
    ).toContain("don't fit the fields");
    expect((await call("save_item", { collection: "news", slug: "Bad Name", values: {} })).text).toContain(
      "can't be an item's name",
    );
  });

  it("changes settings and menus, but not the site's address", async () => {
    const { call, fake } = await connect();
    const { draft } = (await call("update_settings", { settings: { title: "St. Joseph Parish" } })).json();
    expect(fake.repo.files(`goodfellow-draft-${draft}`).get("content/site.json")).toContain(
      '"title": "St. Joseph Parish"',
    );
    expect((await call("update_settings", { settings: { url: "https://elsewhere.example" } })).text).toContain(
      "Domain screen",
    );
    expect((await call("update_settings", { settings: { theme: "blue" } })).isError).toBe(true);
    await call("save_menu", { menu: "main", items: [{ label: "Home", href: "/" }], draft });
    expect((await call("get_menus", { draft })).json().main).toEqual([{ label: "Home", href: "/" }]);
  });

  it("submits a draft for review instead of publishing it", async () => {
    const { call, fake } = await connect();
    const { draft } = (await call("save_page", { address: "/about", blocks: [heading("About")] })).json();
    expect((await call("submit_for_review", { draft, title: "New About page" })).json()).toEqual({
      submitted: true,
      review: "https://github.com/parish/site/pull/1",
    });
    expect(fake.repo.reviews[0]).toMatchObject({ title: "New About page", branch: `goodfellow-draft-${draft}` });
  });

  it("refuses to publish over someone else's change to the same page", async () => {
    const { call, fake } = await connect();
    const { draft } = (await call("save_page", { address: "/about", blocks: [heading("Mine")] })).json();
    fake.repo.write("content/pages/about.json", '{"version":1,"data":{"root":{"props":{}},"content":[]}}');
    const result = await call("publish", { draft, message: "Mine" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("would undo theirs");
  });

  it("only submits for review on sites whose config turns publishing off", async () => {
    const { call } = await connect({ description: describeSite({ blocks, claude: { publish: false } }) });
    expect((await call("get_site")).json().cantPublish).toContain("turned off publishing");
    const { draft } = (await call("save_page", { address: "/about", blocks: [heading("Mine")] })).json();
    const result = await call("publish", { draft, message: "Mine" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("submit_for_review");
    expect((await call("get_page", { address: "/about" })).text).toContain("About us");
    expect((await call("submit_for_review", { draft, title: "Mine" })).json()).toMatchObject({ submitted: true });
  });

  it("doesn't change sites built with a release it can't write for, but still reads them", async () => {
    const { call } = await connect({ description: { ...describeSite({ blocks }), goodfellow: "0.0.1" } });
    expect((await call("get_site")).json().cantChange).toContain("too old");
    expect((await call("save_page", { address: "/about", blocks: [] })).text).toContain("Updates screen");
  });
});

describe("screenshots", () => {
  it("takes the live page, or a draft's through the site's preview page", async () => {
    const taken: Array<Parameters<Screenshotter["take"]>[0]> = [];
    const screenshots: Screenshotter = {
      take: async (options) => {
        taken.push(options);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    };
    const { call } = await connect({ screenshots });
    const live = await call("screenshot", { address: "/about", width: 390 });
    expect(live.content[0]).toEqual({ type: "image", data: btoa("\x89PNG"), mimeType: "image/png" });
    expect(taken[0]).toEqual({ url: "https://parish.example/about", width: 390, dark: false });

    const { draft } = (await call("save_page", { address: "/about", blocks: [heading("Draft heading")] })).json();
    await call("screenshot", { address: "/about", draft });
    expect(taken[1]?.url).toBe("https://parish.example/admin/#/preview");
    expect(taken[1]?.width).toBe(1280);
    expect(taken[1]?.preview?.path).toBe("/about");
    expect(taken[1]?.preview?.files["content/pages/about.json"]).toContain("Draft heading");
    expect(Object.keys(taken[1]?.preview?.files ?? {})).toContain("content/site.json");

    // Dark, as visitors whose computer is set to dark see it, live and in a draft.
    await call("screenshot", { address: "/about", dark: true });
    expect(taken[2]).toEqual({ url: "https://parish.example/about", width: 1280, dark: true });
    await call("screenshot", { address: "/about", draft, dark: true });
    expect(taken[3]).toMatchObject({ dark: true, preview: { path: "/about", dark: true } });
  });

  it("takes images in the media library, and nothing else that isn't a page", async () => {
    const taken: Array<Parameters<Screenshotter["take"]>[0]> = [];
    const screenshots: Screenshotter = {
      take: async (options) => {
        taken.push(options);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      },
    };
    const { call } = await connect({ screenshots });
    expect((await call("screenshot", { address: "/media/photo.jpg" })).isError).toBe(false);
    expect(taken).toEqual([{ url: "https://parish.example/media/photo.jpg", width: 1280, image: true, dark: false }]);
    expect((await call("screenshot", { address: "/media/missing.jpg" })).text).toContain(
      "no file at /media/missing.jpg",
    );
    expect((await call("screenshot", { address: "/media/../admin/x.png" })).text).toContain("isn't an image");
    expect((await call("screenshot", { address: "/media/notes.pdf" })).text).toContain("isn't an image");
    expect(taken).toHaveLength(1);
  });
});
