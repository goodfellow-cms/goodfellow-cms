/**
 * The Claude connector's tools. Changes always go into a draft (a branch of
 * the site's repository), which Claude shows the editor in screenshots, then
 * publishes or submits for review when the editor says so. The tools keep
 * nothing between calls: the draft's name, which every change returns, is how
 * Claude carries on with one.
 */

import { cleanProps, objectSchema, slotNames, toContent, toFlatBlocks } from "@goodfellow-cms/ai/schema";
import {
  ConflictError,
  type ContentSource,
  type ContentStore,
  type Draft,
  DraftError,
  entryFieldProblems,
  entryFileChange,
  entryPathIn,
  type FileChange,
  FOOTER_FILE,
  HEADER_FILE,
  hasLanguages,
  isAddressSegment,
  isEmptyValue,
  isOtherLanguage,
  isReservedPagePath,
  layoutFileChange,
  limitsContent,
  limitsFor,
  mainLanguage,
  menusFileChange,
  menusFileSchema,
  newDraftName,
  outsideLimits,
  pageFileChange,
  pageFileToPath,
  RateLimitError,
  readPermissions,
  reviewersFor,
  SignInError,
  siteLanguages,
  siteSettingsFileChange,
  siteSettingsSchema,
  writeChanges,
} from "@goodfellow-cms/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config, Content, Data, Fields } from "@puckeditor/core";
import { z } from "zod";
import {
  contentFiles,
  entryAddresses,
  entryLanguages,
  isMediaAddress,
  listCollections,
  listMedia,
  listPages,
  mediaImage,
  pageAddress,
  readCollection,
  readEntry,
  readLayout,
  readMenus,
  readPage,
  readSettings,
  ToolError,
  takenAddresses,
} from "./content.js";
import { type ConnectorContext, type OpenedSite, openSite } from "./site.js";

/** What Claude is told about working with Goodfellow sites. */
export const INSTRUCTIONS = `These tools edit websites built with Goodfellow, for people who aren't developers.

- Start with get_site, which lists the site's pages, collections and blocks.
- Changes are saved in a draft, never straight to the live site. The first change starts one and returns its name: pass that name as "draft" to every later change and read, so they build on each other.
- Pages, the header and the footer are made of blocks. get_blocks says which blocks the site has and what each one's props are. Blocks are written as a flat list in page order: a block inside another names it as "parent", and which of its places it goes in as "slot".
- Show the editor what a draft looks like with screenshot before anything goes live.
- Only publish when the editor says to. If they'd like someone to check it first, use submit_for_review instead.
- Use the site's own words for things: say "publish", not "commit" or "merge".`;

/** Why `publish` refuses, on sites whose config says `claude: { publish: false }`. */
const NO_PUBLISHING =
  "The site's owner has turned off publishing from Claude. Submit the draft for review instead (submit_for_review), and someone who looks after the site publishes it.";

const siteArg = z.string().optional().describe("Which site, from list_sites. Leave it out when there's only one.");
const languageArg = z
  .string()
  .optional()
  .describe(
    "On a site in several languages, the code of a language from get_site. Leave it out for the main language.",
  );
const draftArg = z
  .string()
  .optional()
  .describe(
    "The draft, as an earlier change returned it. To read: leave it out for the live site. To change: leave it out to start a new draft.",
  );
const flatBlock = z.object({
  type: z.string().describe("The block's name, from get_blocks."),
  id: z.string().describe("A short id, unique in this list, such as b1."),
  parent: z.string().nullable().describe("The id of the block this one is inside, listed earlier, or null."),
  slot: z.string().nullable().describe("Which place in the parent block this one goes in, or null."),
  props: z.record(z.string(), z.unknown()).describe("The block's props, as get_blocks describes them."),
});

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Turns what went wrong into words the editor can act on. Never includes a token: backends' errors don't. */
function explain(error: unknown): CallToolResult {
  if (error instanceof ToolError) return failure(error.message);
  if (error instanceof DraftError) {
    if (error.problem === "not-found") {
      return failure(
        "That draft isn't there any more: it may have been published or discarded. Make the change again without a draft to start a new one.",
      );
    }
    if (error.problem === "no-reviews") {
      return failure(
        "This sign-in can't ask for a review on the site's host. Publish the draft instead, if the editor agrees, or ask the site's owner.",
      );
    }
    return failure(error.message);
  }
  if (error instanceof ConflictError) {
    return failure(
      "Someone changed the same part of the site while this was being saved. Read it again (with the draft), then make the change again.",
    );
  }
  if (error instanceof RateLimitError) {
    const when = error.resetsAt
      ? ` It can carry on after ${error.resetsAt.toISOString().replace(/\.\d+Z$/, "Z")}`
      : " It can carry on in a few minutes";
    return failure(
      `The site's host is limiting how many requests Claude can make.${when}: what's saved so far stays in the draft. Fewer, larger changes help, such as one save_page with every block rather than one for each.`,
    );
  }
  if (error instanceof SignInError) {
    return failure(
      error.problem === "cant-publish"
        ? "This sign-in can read the site but can't change it. Ask the site's owner to give you permission to edit it."
        : "Signing in to the site's host didn't work. Connect Claude to the site again.",
    );
  }
  return failure(`Something went wrong: ${(error as Error).message ?? String(error)}`);
}

function countBlocks(content: Content, config: Config): number {
  return content.reduce((count, block) => {
    const component = config.components[block.type];
    const nested = slotNames(component as never).reduce(
      (inner, slot) => inner + countBlocks((block.props[slot] as Content | undefined) ?? [], config),
      0,
    );
    return count + 1 + nested;
  }, 0);
}

function newId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 10)}`;
}

function blocksFrom(blocks: unknown[], config: Config): { content: Content; ignored: number } {
  const content = toContent({ blocks }, config, newId);
  return { content, ignored: blocks.length - countBlocks(content, config) };
}

export function registerTools(server: McpServer, context: ConnectorContext): void {
  const now = context.now ?? (() => new Date());

  async function siteId(given: string | undefined): Promise<string> {
    if (given) return given;
    const sites = await context.sites();
    const [only] = sites;
    if (sites.length === 1 && only) return only.id;
    throw new ToolError(
      sites.length === 0
        ? "Claude isn't connected to any sites yet. Connect it to a site first."
        : `Say which site: ${sites.map((site) => site.id).join(", ")}.`,
    );
  }

  /** Sites' addresses found on their hosts' Pages, where Site settings has none. */
  const addresses = new Map<string, string>();

  async function open(given: string | undefined): Promise<OpenedSite> {
    return openSite(context, await siteId(given), addresses);
  }

  async function draftOf(site: OpenedSite, name: string): Promise<Draft> {
    if (!site.backend.drafts) throw new ToolError("This site's host can't keep drafts, which Claude's changes need.");
    return site.backend.drafts.open(name);
  }

  /** The draft to change: the one named, or a new one. Refuses sites that can't take changes. */
  async function changing(site: OpenedSite, name: string | undefined): Promise<Draft> {
    if (site.versionProblem) throw new ToolError(site.versionProblem);
    if (name) return draftOf(site, name);
    const drafts = site.backend.drafts;
    if (!drafts) throw new ToolError("This site's host can't keep drafts, which Claude's changes need.");
    try {
      return await drafts.create(newDraftName(now()));
    } catch (error) {
      // A site on this computer keeps one draft at a time.
      if (!(error instanceof DraftError) || error.problem !== "exists") throw error;
      const [open] = await drafts.list();
      throw new ToolError(
        `There's a draft already, ${open ?? "started earlier"}: pass it as "draft" to add to it, or publish or discard it first.`,
      );
    }
  }

  /** Where to read from: a draft, or the live site. */
  async function reading(site: OpenedSite, name: string | undefined): Promise<ContentSource> {
    return name ? (await draftOf(site, name)).store : site.backend;
  }

  /**
   * The draft's changes outside what an owner lets the connected person change
   * (`content/permissions.json`), in words, or none where they have no limits.
   * Only the files the changes touch are read.
   */
  async function outsideTheirLimits(site: OpenedSite, draft: Draft): Promise<string[]> {
    const limits = limitsFor(await readPermissions(site.backend), site.backend.user.login);
    if (!limits) return [];
    const changes = await draft.changes();
    return outsideLimits(await limitsContent(site.backend, changes), limits, changes).map((problem) =>
      problem.kind === "page" ? `the page ${problem.address}` : problem.path,
    );
  }

  /** Who's asked to review: the people the site's permissions name, else its owners where the sign-in can list them. */
  async function reviewersOf(site: OpenedSite): Promise<string[]> {
    const owners = await site.backend.editors
      ?.list()
      .then((list) => list.editors.flatMap((editor) => (editor.role === "owner" && editor.login ? [editor.login] : [])))
      .catch((): string[] => []);
    const self = site.backend.user.login.toLowerCase();
    return reviewersFor(await readPermissions(site.backend), owners ?? []).filter(
      (login) => login.toLowerCase() !== self,
    );
  }

  async function save(draft: Draft, changes: FileChange[], message: string): Promise<void> {
    const store: ContentStore = draft.store;
    await writeChanges(store, changes, { message, expectedRevision: await store.revision() });
  }

  function tool<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
    readOnly = false,
  ): void {
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: false } },
      // biome-ignore lint/suspicious/noExplicitAny: the SDK's types for raw shapes don't follow through generics
      (async (args: any) => {
        try {
          return await run(args);
        } catch (error) {
          return explain(error);
        }
      }) as never,
    );
  }

  tool(
    "list_sites",
    "The Goodfellow sites this connection can edit.",
    {},
    async () =>
      text((await context.sites()).map((site) => ({ site: site.id, ...(site.label && { name: site.label }) }))),
    true,
  );

  tool(
    "get_site",
    "An overview of a site: its name and address, pages, collections, menus and blocks. Start here.",
    { site: siteArg, draft: draftArg },
    async ({ site: given, draft }) => {
      const site = await open(given);
      const source = await reading(site, draft);
      const [pages, collections, menus] = await Promise.all([
        listPages(source),
        listCollections(source),
        readMenus(source),
      ]);
      return text({
        site: site.id,
        name: site.settings.title,
        address: site.url,
        ...(site.versionProblem && { cantChange: site.versionProblem }),
        ...(site.description.claude?.publish === false && { cantPublish: NO_PUBLISHING }),
        // Screenshots can show it both ways.
        ...(site.settings.theme.darkMode && { darkMode: true }),
        pages: pages.map((page) => page.address),
        collections: collections.map((collection) => ({ id: collection.id, entries: collection.entries.length })),
        menus: Object.keys(menus.menus),
        ...(hasLanguages(site.settings) && {
          languages: siteLanguages(site.settings).map((language) => ({
            code: language.code,
            name: language.name,
            ...(language.main ? { main: true } : { pagesUnder: language.prefix }),
          })),
        }),
        blocks: Object.entries(site.description.blocks).map(([name, block]) => ({
          name,
          ...(block.label && { label: block.label }),
          ...(block.templateOnly && { onlyInCollectionTemplates: true }),
        })),
      });
    },
    true,
  );

  tool(
    "get_blocks",
    "What each of the site's blocks is and the props it takes, as JSON Schema, and the places in it where other blocks go (slots). Also the page settings' props.",
    {
      site: siteArg,
      names: z.array(z.string()).optional().describe("Only these blocks. Leave it out for all of them."),
    },
    async ({ site: given, names }) => {
      const site = await open(given);
      const blocks = Object.entries(site.templateConfig.components).filter(([name]) => !names || names.includes(name));
      return text({
        pageSettings: objectSchema(site.description.root.fields as Fields) ?? {},
        blocks: blocks.map(([name, component]) => ({
          name,
          ...(component.label && { label: component.label }),
          slots: slotNames(component as never),
          ...(site.description.blocks[name]?.templateOnly && { onlyInCollectionTemplates: true }),
          props: objectSchema(component.fields as Fields) ?? {},
        })),
      });
    },
    true,
  );

  tool(
    "get_page",
    "A page's settings (such as its title) and its blocks, as a flat list.",
    { site: siteArg, address: z.string().describe("The page's address, such as / or /about."), draft: draftArg },
    async ({ site: given, address, draft }) => {
      const site = await open(given);
      const path = pageAddress(address);
      const page = await readPage(await reading(site, draft), path);
      if (!page) throw new ToolError(`The site has no page at ${path}. get_site lists its pages.`);
      return text({
        address: path,
        settings: page.content.data.root.props ?? {},
        blocks: toFlatBlocks(page.content.data.content, site.pageConfig),
      });
    },
    true,
  );

  tool(
    "save_page",
    "Creates a page, or changes one, in a draft. Give the whole list of blocks: it replaces the page's blocks. Leave blocks out to change only its settings.",
    {
      site: siteArg,
      address: z.string().describe("The page's address, such as /about. A new address makes a new page."),
      draft: draftArg,
      settings: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Page settings to change, such as title and description, as get_blocks describes them."),
      blocks: z.array(flatBlock).optional(),
    },
    async ({ site: given, address, draft: name, settings, blocks }) => {
      const site = await open(given);
      const path = pageAddress(address);
      const draft = await changing(site, name);
      const existing = await readPage(draft.store, path);
      if (!existing) {
        if (isReservedPagePath(path))
          throw new ToolError(`${path} is kept for the admin panel. Choose another address.`);
        if ((await takenAddresses(draft.store)).has(path)) {
          throw new ToolError(`${path} is already a collection item's address. Choose another one.`);
        }
      }
      const before: Data = existing?.content.data ?? { root: { props: {} }, content: [] };
      const props = {
        ...(before.root.props ?? {}),
        ...cleanProps(site.description.root.fields as Fields, settings ?? {}, undefined),
      };
      const built = blocks ? blocksFrom(blocks, site.pageConfig) : { content: before.content, ignored: 0 };
      const data: Data = { ...before, root: { ...before.root, props }, content: built.content };
      const title = typeof props.title === "string" && props.title ? props.title : path;
      // A page scheduled in the admin panel keeps its schedule.
      await save(
        draft,
        [pageFileChange(path, data, existing?.content)],
        `${existing ? "Update" : "Add"} page "${title}"`,
      );
      return text({
        draft: draft.name,
        address: path,
        saved: existing ? "changed" : "created",
        ...(built.ignored > 0 && {
          ignored: `${built.ignored} block(s) weren't saved: their type isn't one of the site's blocks, or they were in a block that wasn't.`,
        }),
      });
    },
  );

  tool(
    "delete_page",
    "Deletes a page, in a draft.",
    { site: siteArg, address: z.string(), draft: draftArg },
    async ({ site: given, address, draft: name }) => {
      const site = await open(given);
      const path = pageAddress(address);
      if (path === "/") throw new ToolError("The home page can't be deleted. Change it instead.");
      const draft = await changing(site, name);
      const page = await readPage(draft.store, path);
      if (!page) throw new ToolError(`The site has no page at ${path}.`);
      await save(draft, [{ path: page.file, delete: true }], `Delete page ${path}`);
      return text({ draft: draft.name, address: path, saved: "deleted" });
    },
  );

  tool(
    "get_layout",
    "The site's header or footer: its blocks, as a flat list. Every page shows them.",
    { site: siteArg, part: z.enum(["header", "footer"]), draft: draftArg },
    async ({ site: given, part, draft }) => {
      const site = await open(given);
      const layout = await readLayout(await reading(site, draft), part);
      return text({ part, blocks: toFlatBlocks(layout.data.content, site.pageConfig) });
    },
    true,
  );

  tool(
    "save_layout",
    "Changes the site's header or footer, in a draft. Give the whole list of blocks: it replaces them.",
    { site: siteArg, part: z.enum(["header", "footer"]), draft: draftArg, blocks: z.array(flatBlock) },
    async ({ site: given, part, draft: name, blocks }) => {
      const site = await open(given);
      const draft = await changing(site, name);
      const before = await readLayout(draft.store, part);
      const built = blocksFrom(blocks, site.pageConfig);
      await save(
        draft,
        [layoutFileChange(part === "header" ? HEADER_FILE : FOOTER_FILE, { ...before.data, content: built.content })],
        `Update ${part}`,
      );
      return text({ draft: draft.name, part, saved: "changed", ...(built.ignored > 0 && { ignored: built.ignored }) });
    },
  );

  tool(
    "get_collection",
    "A collection (such as news or events): its fields, the address its items have, and its items.",
    { site: siteArg, collection: z.string().describe("The collection's id, from get_site."), draft: draftArg },
    async ({ site: given, collection: id, draft }) => {
      const site = await open(given);
      const source = await reading(site, draft);
      const collection = await readCollection(source, id);
      const { settings } = collection;
      const siteSettings = await readSettings(source);
      const [languages, addresses] = await Promise.all([
        entryLanguages(source, collection, siteSettings),
        entryAddresses(source, collection, siteSettings),
      ]);
      const several = hasLanguages(siteSettings);
      return text({
        id,
        name: settings.name,
        itemName: settings.entryName,
        ...(settings.path !== undefined && { address: settings.path }),
        ...(settings.markdown && { markdownField: settings.markdown.body }),
        fields: settings.fields,
        items: collection.entries.map((entry) => ({
          slug: entry.slug,
          ...(addresses.has(entry.slug) && { address: addresses.get(entry.slug) }),
          ...(several && { language: languages.get(entry.slug) }),
        })),
      });
    },
    true,
  );

  tool(
    "get_item",
    "One item of a collection: its fields' values.",
    { site: siteArg, collection: z.string(), slug: z.string(), draft: draftArg },
    async ({ site: given, collection: id, slug, draft }) => {
      const site = await open(given);
      const source = await reading(site, draft);
      const collection = await readCollection(source, id);
      const entry = await readEntry(source, collection, slug);
      if (!entry) throw new ToolError(`The collection "${id}" has no item "${slug}".`);
      return text({ collection: id, slug, values: entry.content.fields });
    },
    true,
  );

  tool(
    "save_item",
    "Creates an item of a collection, or changes one, in a draft. Values not given stay as they are. Formatted text is simple HTML; a collection's Markdown field is Markdown.",
    {
      site: siteArg,
      collection: z.string(),
      slug: z
        .string()
        .describe("The item's name in its address and file: lowercase letters, numbers and hyphens, such as open-day."),
      values: z.record(z.string(), z.unknown()).describe("Field values, by the fields' names from get_collection."),
      language: z
        .string()
        .optional()
        .describe(
          "For a new item on a site in several languages, the code of the language it's in, from get_site. Leave it out for the site's main language. Names are the collection's whatever an item's language, so a translation has a name of its own.",
        ),
      draft: draftArg,
    },
    async ({ site: given, collection: id, slug, values, language, draft: name }) => {
      const site = await open(given);
      const draft = await changing(site, name);
      const collection = await readCollection(draft.store, id);
      const existing = await readEntry(draft.store, collection, slug);
      const siteSettings = await readSettings(draft.store);
      if (
        language !== undefined &&
        existing &&
        language !== (existing.content.inLanguage ?? mainLanguage(siteSettings))
      ) {
        throw new ToolError(`An item's language can't change. Save the translation as an item of its own.`);
      }
      if (
        language !== undefined &&
        language !== mainLanguage(siteSettings) &&
        !isOtherLanguage(siteSettings, language)
      ) {
        throw new ToolError(`${language} isn't one of the site's languages. get_site lists them.`);
      }
      const inLanguage = language !== undefined && language !== mainLanguage(siteSettings) ? language : undefined;
      if (!existing) {
        if (!isAddressSegment(slug)) {
          throw new ToolError(`"${slug}" can't be an item's name: use lowercase letters, numbers and hyphens.`);
        }
        const path = entryPathIn(siteSettings, collection.settings, slug, inLanguage ?? mainLanguage(siteSettings));
        if (path && (isReservedPagePath(path) || (await takenAddresses(draft.store)).has(path))) {
          throw new ToolError(`${path} is already taken on the site. Choose another name.`);
        }
      }
      const known = new Set(collection.settings.fields.map((field) => field.name));
      const unknown = Object.keys(values).filter((field) => !known.has(field));
      if (unknown.length > 0) {
        throw new ToolError(`The collection has no field ${unknown.join(", ")}. get_collection lists its fields.`);
      }
      const fields = { ...(existing?.content.fields ?? {}), ...values };
      const problems = entryFieldProblems(collection.settings.fields, fields);
      if (problems.length > 0) throw new ToolError(`Those values don't fit the fields: ${problems.join("; ")}.`);
      // As the admin panel's item editor asks for.
      const missing = collection.settings.fields.filter((field) => field.required && isEmptyValue(fields[field.name]));
      if (missing.length > 0) {
        throw new ToolError(`The item needs a value for: ${missing.map((field) => field.name).join(", ")}.`);
      }
      const change = entryFileChange(
        { id, settings: collection.settings },
        slug,
        fields,
        existing?.content ?? (inLanguage ? { inLanguage } : undefined),
      );
      const title = typeof fields.title === "string" ? fields.title : slug;
      await save(
        draft,
        [change],
        `${existing ? "Update" : "Add"} ${collection.settings.entryName.toLowerCase()} "${title}"`,
      );
      return text({ draft: draft.name, collection: id, slug, saved: existing ? "changed" : "created" });
    },
  );

  tool(
    "delete_item",
    "Deletes an item of a collection, in a draft.",
    { site: siteArg, collection: z.string(), slug: z.string(), draft: draftArg },
    async ({ site: given, collection: id, slug, draft: name }) => {
      const site = await open(given);
      const draft = await changing(site, name);
      const collection = await readCollection(draft.store, id);
      const entry = collection.entries.find((candidate) => candidate.slug === slug);
      if (!entry) throw new ToolError(`The collection "${id}" has no item "${slug}".`);
      await save(
        draft,
        [{ path: entry.file, delete: true }],
        `Delete ${collection.settings.entryName.toLowerCase()} ${slug}`,
      );
      return text({ draft: draft.name, collection: id, slug, saved: "deleted" });
    },
  );

  tool(
    "get_settings",
    "The site's settings: its name, description, logo, theme colors and fonts, contact details and the like.",
    { site: siteArg, draft: draftArg },
    async ({ site: given, draft }) => {
      const site = await open(given);
      return text(await readSettings(await reading(site, draft)));
    },
    true,
  );

  tool(
    "update_settings",
    "Changes some of the site's settings, in a draft. Settings not given stay as they are. The site's address is changed on the admin panel's Domain screen instead.",
    { site: siteArg, settings: z.record(z.string(), z.unknown()), draft: draftArg },
    async ({ site: given, settings: changes, draft: name }) => {
      const site = await open(given);
      const draft = await changing(site, name);
      const current = await readSettings(draft.store);
      if ("url" in changes && changes.url !== current.url) {
        throw new ToolError("The site's address is changed on the admin panel's Domain screen, not by Claude.");
      }
      const result = siteSettingsSchema.safeParse({ ...current, ...changes, version: current.version });
      if (!result.success) {
        throw new ToolError(
          `Those settings don't fit: ${result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}.`,
        );
      }
      await save(draft, [siteSettingsFileChange(result.data)], "Update site settings");
      return text({ draft: draft.name, saved: "changed" });
    },
  );

  tool(
    "get_menus",
    "The site's menus, by name: each a list of links, which can have links of their own under them. On a site in several languages, give a language's code for its menus; a language without menus of its own shows the main language's.",
    { site: siteArg, language: languageArg, draft: draftArg },
    async ({ site: given, language, draft }) => {
      const site = await open(given);
      const { menus, languageMenus } = await readMenus(await reading(site, draft));
      if (language === undefined || language === mainLanguage(site.settings)) return text(menus);
      const own = languageMenus[language];
      return text(own ? own : { sameAsMainLanguage: true, menus });
    },
    true,
  );

  tool(
    "save_menu",
    "Replaces one of the site's menus, in a draft: a list of links, each with a label and an href.",
    {
      site: siteArg,
      menu: z.string().describe("The menu's name, such as main or footer."),
      items: z.array(z.unknown()),
      language: languageArg,
      draft: draftArg,
    },
    async ({ site: given, menu, items, language, draft: name }) => {
      const site = await open(given);
      const draft = await changing(site, name);
      const { menus, languageMenus } = await readMenus(draft.store);
      const settings = await readSettings(draft.store);
      const other = language !== undefined && language !== mainLanguage(settings);
      if (other && !isOtherLanguage(settings, language)) {
        throw new ToolError(`${language} isn't one of the site's languages. get_site lists them.`);
      }
      // A language's own menus start as a copy of the main language's.
      const file = other
        ? {
            version: 1,
            menus,
            languages: { ...languageMenus, [language]: { ...(languageMenus[language] ?? menus), [menu]: items } },
          }
        : { version: 1, menus: { ...menus, [menu]: items }, languages: languageMenus };
      const result = menusFileSchema.safeParse(file);
      if (!result.success) {
        throw new ToolError(
          `That menu doesn't fit: ${result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}.`,
        );
      }
      await save(
        draft,
        [menusFileChange({ menus: result.data.menus, languageMenus: result.data.languages })],
        `Update menu "${menu}"`,
      );
      return text({ draft: draft.name, menu, saved: "changed" });
    },
  );

  tool(
    "list_media",
    "The site's uploaded images and files: the address blocks use for each, such as /media/photo.jpg, its size in bytes, and its credit if it has one. Pages that use a credited file show its credit by themselves, as its license requires, so use it as it is. To see an image, take a screenshot of its address. New files are uploaded in the admin panel.",
    { site: siteArg },
    async ({ site: given }) => {
      const site = await open(given);
      return text(await listMedia(site.backend));
    },
    true,
  );

  tool(
    "get_draft",
    "What a draft changes compared with the live site.",
    { site: siteArg, draft: z.string() },
    async ({ site: given, draft: name }) => {
      const site = await open(given);
      const draft = await draftOf(site, name);
      const changes = await draft.changes();
      return text({
        draft: draft.name,
        changes: changes.map((change) => {
          const kind = "delete" in change ? "deleted" : "changed";
          if (change.path.startsWith("content/pages/")) return { page: pageFileToPath(change.path), [kind]: true };
          return { file: change.path, [kind]: true };
        }),
      });
    },
    true,
  );

  if (context.screenshots) {
    const screenshots = context.screenshots;
    tool(
      "screenshot",
      "A picture of a page, as it is on the live site or with a draft's changes, or of an image in the media library (its address from list_media), to see what it shows. Show pages to the editor before publishing.",
      {
        site: siteArg,
        address: z.string().describe("A page's address, such as /about, or an image's, such as /media/photo.jpg."),
        draft: draftArg,
        width: z
          .union([z.literal(390), z.literal(768), z.literal(1280)])
          .optional()
          .describe("390 for a phone, 768 for a tablet, 1280 (the default) for a computer."),
        dark: z
          .boolean()
          .optional()
          .describe("Shows the page as visitors whose computer is set to dark see it, on sites with dark mode."),
      },
      async ({ site: given, address, draft: name, width = 1280, dark = false }) => {
        const site = await open(given);
        if (isMediaAddress(address)) {
          // Media isn't in drafts: uploads go straight to the live site, so this is always the live file.
          const image = await mediaImage(site.backend, address);
          const png = await screenshots.take({ url: `${site.url}${image}`, width, image: true, dark });
          return { content: [{ type: "image", data: base64(png), mimeType: "image/png" }] };
        }
        const path = pageAddress(address);
        const png = name
          ? await screenshots.take({
              url: `${site.url}/admin/#/preview`,
              width,
              dark,
              preview: { files: await contentFiles((await draftOf(site, name)).store), path, dark },
            })
          : await screenshots.take({ url: `${site.url}${path === "/" ? "/" : path}`, width, dark });
        return { content: [{ type: "image", data: base64(png), mimeType: "image/png" }] };
      },
      true,
    );
  }

  tool(
    "publish",
    "Publishes a draft: its changes go live, in one go, and the draft is removed. Only when the editor has said to, and not on sites whose owner has turned it off (get_site says so); submit_for_review instead.",
    {
      site: siteArg,
      draft: z.string(),
      message: z.string().describe('What the changes are, in a few words, such as "New page about the summer fair".'),
    },
    async ({ site: given, draft: name, message }) => {
      const site = await open(given);
      if (site.versionProblem) throw new ToolError(site.versionProblem);
      // Read from what the site's own build published, which only its code can change.
      if (site.description.claude?.publish === false) throw new ToolError(NO_PUBLISHING);
      const draft = await draftOf(site, name);
      const outside = await outsideTheirLimits(site, draft);
      if (outside.length > 0) {
        throw new ToolError(
          `An owner has limited what you can change on this site, and this draft changes things outside it: ${outside.join(", ")}. Submit it for review instead (submit_for_review), and a reviewer publishes it.`,
        );
      }
      try {
        await draft.publish(message);
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ToolError(
            "Someone published changes to the same pages since this draft started, so publishing it would undo theirs. The draft is still there: read the pages again from the live site, make the changes again in a new draft, then publish that.",
          );
        }
        throw error;
      }
      return text({
        published: true,
        note: site.id.startsWith("local:")
          ? "The changes are in the site's folder on this computer now. Publish them as you would any change to the site's files, such as by committing and pushing them."
          : "The site is being rebuilt with the changes, which usually takes a minute or two.",
        address: site.url,
      });
    },
  );

  tool(
    "submit_for_review",
    "Asks for a draft to be checked before it goes live: someone who looks after the site reviews it on GitHub or GitLab, and publishes it from there.",
    {
      site: siteArg,
      draft: z.string(),
      title: z.string().describe("What the changes are, in a few words."),
      description: z.string().optional().describe("More about the changes, for whoever reviews them."),
    },
    async ({ site: given, draft: name, title, description }) => {
      const site = await open(given);
      const draft = await draftOf(site, name);
      const reviewers = await reviewersOf(site);
      const review = await draft.submitForReview({
        title,
        ...(description && { description }),
        ...(reviewers.length > 0 && { reviewers }),
      });
      return text({ submitted: true, review: review.url });
    },
  );

  tool(
    "discard_draft",
    "Throws a draft and its changes away. The live site isn't affected.",
    { site: siteArg, draft: z.string() },
    async ({ site: given, draft: name }) => {
      const site = await open(given);
      const draft = await draftOf(site, name);
      await draft.discard();
      return text({ discarded: true });
    },
  );
}
