import { z } from "zod";
import type { SiteContent } from "./content/load.js";
import {
  COMPONENTS_DIR,
  HOOKS_DIR,
  INSTALLED_BLOCKS_DIR,
  INSTALLED_INDEX_FILE,
  INSTALLED_RECORD_FILE,
  LIB_DIR,
} from "./content/paths.js";
import { serializeContent } from "./content/serialize.js";
import { type FileChange, isEditablePath } from "./content/store.js";

/**
 * Block registries: shadcn registries whose items are Goodfellow blocks. An
 * item is a block when its `meta.goodfellow` says how the editor lists it; its
 * one `registry:block` file default-exports the block's Puck config. Installing
 * copies the item's files, and those of its `registryDependencies`, into the
 * site, where `blocks/installed/index.ts` makes them part of the config.
 */

/** Registry item names, which installed blocks keep as their key in content. */
const ITEM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where plain `registryDependencies` such as `"button"` come from, as with the shadcn CLI. */
export const SHADCN_REGISTRY = "https://ui.shadcn.com/r/styles/new-york-v4/{name}.json";

/**
 * The namespace shadcn's own registry goes under in `RegistrySources` where
 * plain names may come from it. It's trusted only where it's listed, as the
 * admin panel lists it only where installed code can't reach editors' tokens.
 */
export const SHADCN_NAMESPACE = "@shadcn";

/** The namespace of Goodfellow's own registry. */
export const GOODFELLOW_REGISTRY = "@goodfellow";

/** Goodfellow's registry for one release, from npm through jsDelivr, so a version always means the same files. */
export function goodfellowRegistryUrl(version: string): string {
  return `https://cdn.jsdelivr.net/npm/@goodfellow-cms/registry@${version}/r/{name}.json`;
}

/**
 * The npm packages sites include for registry blocks. The admin panel can't
 * update a site's lockfile, so it only installs blocks that need nothing else.
 */
export const REGISTRY_PACKAGES = [
  "class-variance-authority",
  "clsx",
  "cn",
  "embla-carousel-react",
  "lucide-react",
  "radix-ui",
  "tailwind-merge",
  "tw-animate-css",
] as const;

/** Registries to install from, by namespace: `{ "@acme": "https://acme.example/r/{name}.json" }`. */
export type RegistrySources = Record<string, string>;

const blockMetaSchema = z.object({
  /** The editor group the block is listed in, such as "Sections". */
  category: z.string().min(1),
  /** Offered by default when a site is created. */
  recommended: z.boolean().optional(),
  /** A picture of the block, relative to the item's address. */
  image: z.string().optional(),
  /** The release of the registry the item belongs to. */
  version: z.string().optional(),
});

export type BlockMeta = z.infer<typeof blockMetaSchema>;

const registryFileSchema = z.object({
  path: z.string().min(1),
  type: z.string(),
  target: z.string().optional(),
  content: z.string(),
});

export const registryItemSchema = z
  .object({
    name: z.string().regex(ITEM_NAME),
    type: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
    registryDependencies: z.array(z.string()).default([]),
    files: z.array(registryFileSchema).default([]),
    meta: z.looseObject({ goodfellow: blockMetaSchema.optional() }).optional(),
  })
  .loose();

export type RegistryItem = z.infer<typeof registryItemSchema>;

/** A registry's `registry.json`: its items, without their files' contents. */
export const registryIndexSchema = z
  .object({
    name: z.string(),
    homepage: z.string().optional(),
    items: z.array(
      z
        .object({
          name: z.string().regex(ITEM_NAME),
          type: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          meta: z.looseObject({ goodfellow: blockMetaSchema.optional() }).optional(),
        })
        .loose(),
    ),
  })
  .loose();

/** A block a registry offers, as the admin panel lists it. */
export interface AvailableBlock {
  /** What installing it takes, such as `@goodfellow/shadcn-faq`. */
  ref: string;
  name: string;
  title: string;
  description?: string;
  category: string;
  recommended: boolean;
  /** The picture's full address, if the registry has one. */
  image?: string;
}

const installedBlockSchema = z.object({
  /** What it was installed from, such as `@goodfellow/shadcn-faq`. */
  source: z.string(),
  title: z.string(),
  category: z.string(),
  version: z.string().optional(),
  /** The file that default-exports the block's config. */
  entry: z.string(),
  /** The files installing it wrote, with a hash of what was written, so removing it leaves files someone changed. */
  files: z.record(z.string(), z.string()),
});

export const installedRecordSchema = z.object({
  version: z.literal(1),
  blocks: z.record(z.string().regex(ITEM_NAME), installedBlockSchema),
});

export type InstalledRecord = z.infer<typeof installedRecordSchema>;
export type InstalledBlock = z.infer<typeof installedBlockSchema>;

export const EMPTY_RECORD: InstalledRecord = { version: 1, blocks: {} };

/** Why installing or removing a block can't go ahead, for the admin panel to explain. */
export type RegistryProblem =
  | { code: "unreachable"; url: string }
  | { code: "invalid"; url: string }
  | { code: "untrusted"; ref: string }
  | { code: "not-a-block"; ref: string }
  | { code: "already-installed"; name: string }
  | { code: "name-taken"; name: string }
  | { code: "packages"; packages: string[] }
  | { code: "unsupported-file"; path: string }
  | { code: "file-exists"; path: string }
  | { code: "not-installed"; name: string }
  | { code: "in-use"; places: BlockUse[] };

export class RegistryError extends Error {
  override name = "RegistryError";

  constructor(readonly problem: RegistryProblem) {
    super(`Block registry problem: ${problem.code}`);
  }
}

/** Fetches and parses JSON. Rejects when it can't be fetched. */
export type FetchJson = (url: string) => Promise<unknown>;

/** The address of the registry's file `name` from a template such as `https://x/r/{name}.json`. */
function fill(template: string, name: string): string {
  return template.replace("{name}", name);
}

function prefixOf(template: string): string {
  return template.slice(0, template.indexOf("{name}"));
}

/**
 * The address of a registry item, from a reference as `registryDependencies`
 * write them: a full address, `@namespace/name`, or a plain name, which means
 * shadcn's own registry (`SHADCN_NAMESPACE`). Only the registries given are trusted.
 */
export function itemUrl(ref: string, registries: RegistrySources): string {
  const templates = Object.values(registries);
  if (/^https?:\/\//.test(ref)) {
    // Compared as the browser would fetch it, so `…/r/../../other/x.json` can't leave the registry's folder.
    let url: string;
    try {
      url = new URL(ref).href;
    } catch {
      throw new RegistryError({ code: "untrusted", ref });
    }
    if (/%2e|%2f|%5c/i.test(url) || !templates.some((template) => url.startsWith(prefixOf(template)))) {
      throw new RegistryError({ code: "untrusted", ref });
    }
    return url;
  }
  const namespaced = /^(@[a-z0-9-]+)\/([a-z0-9-]+)$/.exec(ref);
  if (namespaced) {
    const [, namespace = "", name = ""] = namespaced;
    const template = registries[namespace];
    if (!template) throw new RegistryError({ code: "untrusted", ref });
    return fill(template, name);
  }
  const shadcn = registries[SHADCN_NAMESPACE];
  if (ITEM_NAME.test(ref) && shadcn) return fill(shadcn, ref);
  throw new RegistryError({ code: "untrusted", ref });
}

async function fetchItem(url: string, fetchJson: FetchJson): Promise<RegistryItem> {
  let data: unknown;
  try {
    data = await fetchJson(url);
  } catch {
    throw new RegistryError({ code: "unreachable", url });
  }
  const parsed = registryItemSchema.safeParse(data);
  if (!parsed.success) throw new RegistryError({ code: "invalid", url });
  return parsed.data;
}

/** The blocks each registry offers, in the registries' order. */
export async function availableBlocks(registries: RegistrySources, fetchJson: FetchJson): Promise<AvailableBlock[]> {
  const lists = await Promise.all(
    // shadcn's own registry has components, not blocks.
    Object.entries(registries)
      .filter(([namespace]) => namespace !== SHADCN_NAMESPACE)
      .map(async ([namespace, template]) => {
        const url = fill(template, "registry");
        let data: unknown;
        try {
          data = await fetchJson(url);
        } catch {
          throw new RegistryError({ code: "unreachable", url });
        }
        const parsed = registryIndexSchema.safeParse(data);
        if (!parsed.success) throw new RegistryError({ code: "invalid", url });
        return parsed.data.items.flatMap((item): AvailableBlock[] => {
          const meta = item.meta?.goodfellow;
          if (!meta) return [];
          return [
            {
              ref: `${namespace}/${item.name}`,
              name: item.name,
              title: item.title ?? item.name,
              ...(item.description && { description: item.description }),
              category: meta.category,
              recommended: meta.recommended ?? false,
              ...(meta.image && { image: new URL(meta.image, fill(template, item.name)).href }),
            },
          ];
        });
      }),
  );
  return lists.flat();
}

/** An npm dependency's package name, without its version: `@scope/pkg@1.2` → `@scope/pkg`. */
function packageName(dependency: string): string {
  const at = dependency.indexOf("@", 1);
  return at === -1 ? dependency : dependency.slice(0, at);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Where a file of an item goes in the site, as the shadcn CLI's default settings would put it. */
function targetPath(item: RegistryItem, file: RegistryItem["files"][number], isBlock: boolean): string {
  let path: string;
  if (file.target) path = file.target.replace(/^~\//, "");
  else if (isBlock) path = `${INSTALLED_BLOCKS_DIR}/${item.name}/${basename(file.path)}`;
  else if (file.type === "registry:ui") path = `${COMPONENTS_DIR}/ui/${basename(file.path)}`;
  else if (file.type === "registry:component") path = `${COMPONENTS_DIR}/${basename(file.path)}`;
  else if (file.type === "registry:lib") path = `${LIB_DIR}/${basename(file.path)}`;
  else if (file.type === "registry:hook") path = `${HOOKS_DIR}/${basename(file.path)}`;
  else throw new RegistryError({ code: "unsupported-file", path: file.path });
  if (!isEditablePath(path)) throw new RegistryError({ code: "unsupported-file", path: file.path });
  return path;
}

/** A hex SHA-256 of a file's text, to tell later whether someone changed it. */
export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The record of installed blocks, from `blocks/installed/installed.json`, or an empty one if there's none. */
export function parseInstalledRecord(text: string | undefined): InstalledRecord {
  // A new record each time: callers add to it, and the empty one is shared.
  if (text === undefined) return { version: 1, blocks: {} };
  return installedRecordSchema.parse(JSON.parse(text));
}

/** An identifier for the block's import in the generated index. */
function importName(index: number): string {
  return `block${index}`;
}

/** `blocks/installed/index.ts`, which the site's config imports: every installed block, grouped as the editor lists them. */
export function installedIndex(record: InstalledRecord): string {
  const names = Object.keys(record.blocks).sort();
  const imports = names.map((name, index) => {
    const entry = record.blocks[name]?.entry ?? "";
    const from = `./${entry.slice(INSTALLED_BLOCKS_DIR.length + 1).replace(/\.[cm]?[jt]sx?$/, "")}`;
    return `import ${importName(index)} from ${JSON.stringify(from)};`;
  });
  const blocks = names.map((name, index) => `  ${JSON.stringify(name)}: ${importName(index)},`);
  const categories = new Map<string, string[]>();
  for (const name of names) {
    const category = record.blocks[name]?.category ?? "";
    categories.set(category, [...(categories.get(category) ?? []), name]);
  }
  const groups = [...categories].map(
    ([title, components]) =>
      `  ${JSON.stringify(`installed-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)}: { title: ${JSON.stringify(title)}, components: ${JSON.stringify(components)} },`,
  );
  return [
    "// Written by the admin panel when blocks are installed or removed. Don't edit it by hand.",
    'import type { ComponentConfig, Config } from "@puckeditor/core";',
    ...imports,
    "",
    "// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props",
    `export const installedBlocks: Record<string, ComponentConfig<any>> = {${blocks.length ? `\n${blocks.join("\n")}\n` : ""}};`,
    "",
    `export const installedCategories: NonNullable<Config["categories"]> = {${groups.length ? `\n${groups.join("\n")}\n` : ""}};`,
    "",
  ].join("\n");
}

function recordChanges(record: InstalledRecord): FileChange[] {
  return [
    { path: INSTALLED_RECORD_FILE, content: serializeContent(record) },
    { path: INSTALLED_INDEX_FILE, content: installedIndex(record) },
  ];
}

export interface InstallOptions {
  /** The item to install, such as `@goodfellow/shadcn-faq`. */
  ref: string;
  registries: RegistrySources;
  fetchJson: FetchJson;
  /** Reads a file of the site, or `undefined` if it doesn't exist. */
  readFile: (path: string) => Promise<string | undefined>;
  record: InstalledRecord;
  /** The blocks the site already has, whose names an installed block can't take. */
  blocks: readonly string[];
  /** The npm packages the site has. Defaults to `REGISTRY_PACKAGES`. */
  packages?: readonly string[];
}

export interface Plan {
  changes: FileChange[];
  record: InstalledRecord;
}

/**
 * Works out the files that install a block: its own, and those of every item
 * it depends on. Shared code the site already has (such as a `components/ui`
 * file the site's developer added) is kept as it is; a block's own files never
 * replace existing ones.
 */
export async function planInstall(options: InstallOptions): Promise<Plan & { item: RegistryItem }> {
  const { readFile, record } = options;
  const { root, meta, entry, files } = await blockFiles(options.ref, options);
  if (record.blocks[root.name]) throw new RegistryError({ code: "already-installed", name: root.name });
  if (options.blocks.includes(root.name)) throw new RegistryError({ code: "name-taken", name: root.name });

  const changes: FileChange[] = [];
  const written: Record<string, string> = {};
  for (const [path, { content, isBlock }] of files) {
    const existing = await readFile(path);
    if (existing === undefined) {
      changes.push({ path, content });
      written[path] = await hashText(content);
    } else if (existing === content) {
      written[path] = await hashText(content);
    } else if (isBlock) {
      throw new RegistryError({ code: "file-exists", path });
    }
    // Otherwise the site's own version of shared code stays, and removing the block leaves it.
  }

  const next: InstalledRecord = {
    version: 1,
    blocks: { ...record.blocks, [root.name]: installedBlock(options.ref, root, meta, entry, written) },
  };
  return { changes: [...changes, ...recordChanges(next)], record: next, item: root };
}

function installedBlock(
  source: string,
  root: RegistryItem,
  meta: BlockMeta,
  entry: string,
  files: Record<string, string>,
): InstalledBlock {
  return {
    source,
    title: root.title ?? root.name,
    category: meta.category,
    ...(meta.version && { version: meta.version }),
    entry,
    files,
  };
}

/**
 * A block's registry item and the files it and every item it depends on would
 * write, by path in the site. Refused if it needs packages the site doesn't have.
 */
async function blockFiles(ref: string, options: Pick<InstallOptions, "registries" | "fetchJson" | "packages">) {
  const { registries, fetchJson } = options;
  const rootUrl = itemUrl(ref, registries);
  const root = await fetchItem(rootUrl, fetchJson);
  const meta = root.meta?.goodfellow;
  const entryFiles = root.files.filter((file) => file.type === "registry:block");
  if (!meta || entryFiles.length !== 1) throw new RegistryError({ code: "not-a-block", ref });

  // Every item the block needs, each once.
  const items: Array<{ item: RegistryItem; isBlock: boolean }> = [{ item: root, isBlock: true }];
  const seen = new Set([rootUrl]);
  const queue = [...root.registryDependencies];
  while (queue.length > 0) {
    const dependency = queue.shift() as string;
    const url = itemUrl(dependency, registries);
    if (seen.has(url)) continue;
    seen.add(url);
    const item = await fetchItem(url, fetchJson);
    items.push({ item, isBlock: false });
    queue.push(...item.registryDependencies);
  }

  // Every site has React, Puck and Goodfellow's renderer too.
  const allowed = new Set([
    ...(options.packages ?? REGISTRY_PACKAGES),
    "react",
    "react-dom",
    "@goodfellow-cms/react",
    "@puckeditor/core",
  ]);
  const missing = [
    ...new Set(items.flatMap(({ item }) => item.dependencies.map(packageName)).filter((name) => !allowed.has(name))),
  ];
  if (missing.length > 0) throw new RegistryError({ code: "packages", packages: missing.sort() });

  const files = new Map<string, { content: string; isBlock: boolean }>();
  for (const { item, isBlock } of items) {
    for (const file of item.files) {
      const path = targetPath(item, file, isBlock);
      const earlier = files.get(path);
      if (earlier && earlier.content !== file.content) throw new RegistryError({ code: "file-exists", path });
      files.set(path, { content: file.content, isBlock });
    }
  }
  const entry = targetPath(root, entryFiles[0] as RegistryItem["files"][number], true);
  return { root, meta, entry, files };
}

export interface UpdateOptions extends Omit<InstallOptions, "ref" | "blocks"> {
  /** The installed block's name. */
  name: string;
}

export interface UpdatePlan extends Plan {
  /** Files someone changed since they were installed, which keep their changes rather than the new version. */
  kept: string[];
  /** The block's version before and after, as its registry says. */
  from?: string;
  to?: string;
}

/**
 * Works out the files that update an installed block to what its registry has
 * now. Only files nobody has changed since they were installed are replaced or
 * removed; files someone changed are kept as they are, and listed in `kept`.
 */
export async function planUpdate(options: UpdateOptions): Promise<UpdatePlan> {
  const { name, record, readFile } = options;
  const block = record.blocks[name];
  if (!block) throw new RegistryError({ code: "not-installed", name });
  const { root, meta, entry, files } = await blockFiles(block.source, options);

  const unchanged = async (path: string, existing: string | undefined) =>
    existing !== undefined && block.files[path] !== undefined && (await hashText(existing)) === block.files[path];

  const changes: FileChange[] = [];
  const written: Record<string, string> = {};
  const kept: string[] = [];
  for (const [path, { content }] of files) {
    const existing = await readFile(path);
    if (existing === content) {
      written[path] = await hashText(content);
    } else if (existing === undefined || (await unchanged(path, existing))) {
      changes.push({ path, content });
      written[path] = await hashText(content);
    } else if (block.files[path] !== undefined) {
      // Someone changed it: their version stays, and so does the hash it was installed with.
      kept.push(path);
      written[path] = block.files[path];
    }
    // Otherwise it's the site's own shared code, or another block's, which stays as it is.
  }

  // Files the new version no longer has go, unless someone changed them or another block uses them.
  const { [name]: _old, ...others } = record.blocks;
  const stillNeeded = new Set(Object.values(others).flatMap((other) => Object.keys(other.files)));
  for (const path of Object.keys(block.files)) {
    if (files.has(path) || stillNeeded.has(path)) continue;
    const existing = await readFile(path);
    if (await unchanged(path, existing)) changes.push({ path, delete: true });
    else if (existing !== undefined) kept.push(path);
  }

  const next: InstalledRecord = {
    version: 1,
    blocks: { ...record.blocks, [name]: installedBlock(block.source, root, meta, entry, written) },
  };
  return {
    changes: [...changes, ...recordChanges(next)],
    record: next,
    kept: kept.sort(),
    ...(block.version && { from: block.version }),
    ...(meta.version && { to: meta.version }),
  };
}

/** Somewhere content uses a block. */
export type BlockUse =
  | { kind: "page"; path: string; title?: string }
  | { kind: "template"; collection: string; name: string }
  | { kind: "header" }
  | { kind: "footer" };

/** Whether Puck data uses a block anywhere, including inside other blocks' slots and zones. */
function usesBlock(value: unknown, name: string): boolean {
  if (Array.isArray(value)) return value.some((item) => usesBlock(item, name));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === name && record.props && typeof record.props === "object") return true;
  return Object.values(record).some((item) => usesBlock(item, name));
}

/** Every page, collection template, header and footer that uses a block. */
export function blockUses(content: SiteContent, name: string): BlockUse[] {
  const uses: BlockUse[] = [];
  for (const page of content.pages) {
    if (usesBlock(page.content.data, name)) {
      const title = (page.content.data.root?.props as { title?: unknown } | undefined)?.title;
      uses.push({ kind: "page", path: page.path, ...(typeof title === "string" && title && { title }) });
    }
  }
  for (const collection of content.collections) {
    if (usesBlock(collection.settings.template, name)) {
      uses.push({ kind: "template", collection: collection.id, name: collection.settings.name });
    }
  }
  if (usesBlock(content.header.data, name)) uses.push({ kind: "header" });
  if (usesBlock(content.footer.data, name)) uses.push({ kind: "footer" });
  return uses;
}

export interface RemoveOptions {
  name: string;
  record: InstalledRecord;
  readFile: (path: string) => Promise<string | undefined>;
  content: SiteContent;
}

/**
 * Works out the files that remove an installed block. It's refused while
 * content uses the block. Files another installed block needs, and files
 * someone changed since they were installed, stay.
 */
export async function planRemove({ name, record, readFile, content }: RemoveOptions): Promise<Plan> {
  const block = record.blocks[name];
  if (!block) throw new RegistryError({ code: "not-installed", name });
  const places = blockUses(content, name);
  if (places.length > 0) throw new RegistryError({ code: "in-use", places });

  const { [name]: _removed, ...rest } = record.blocks;
  const stillNeeded = new Set(Object.values(rest).flatMap((other) => Object.keys(other.files)));
  const changes: FileChange[] = [];
  for (const [path, hash] of Object.entries(block.files)) {
    if (stillNeeded.has(path)) continue;
    const existing = await readFile(path);
    if (existing !== undefined && (await hashText(existing)) === hash) changes.push({ path, delete: true });
  }
  const next: InstalledRecord = { version: 1, blocks: rest };
  return { changes: [...changes, ...recordChanges(next)], record: next };
}

/** One block to add, by its registry reference, or to remove, by its name. */
export type BlockChange = { add: string } | { remove: string };

export interface BlockChangesOptions extends Omit<InstallOptions, "ref"> {
  changes: readonly BlockChange[];
  content: SiteContent;
}

/**
 * Works out the files for several blocks added and removed at once, so they can
 * be published together: each is planned with `planInstall()` or `planRemove()`
 * as if the ones before it had been published, and the result is every file's
 * final state.
 */
export async function planBlockChanges(options: BlockChangesOptions): Promise<Plan> {
  const { readFile, content } = options;
  // Each file's state after the changes so far: its new text, or `null` once it's deleted.
  const pending = new Map<string, string | null>();
  const readPending = async (path: string) => {
    const state = pending.get(path);
    if (state === null) return undefined;
    return state ?? readFile(path);
  };
  let record = options.record;
  for (const change of options.changes) {
    const plan =
      "add" in change
        ? await planInstall({ ...options, ref: change.add, readFile: readPending, record })
        : await planRemove({ name: change.remove, record, readFile: readPending, content });
    for (const file of plan.changes) {
      if ("bytes" in file) throw new Error(`Blocks are text, but ${file.path} isn't.`);
      pending.set(file.path, "delete" in file ? null : file.content);
    }
    record = plan.record;
  }

  const changes: FileChange[] = [];
  for (const [path, state] of pending) {
    const existing = await readFile(path);
    if (state === null) {
      // A file added and removed again in the same publish was never there.
      if (existing !== undefined) changes.push({ path, delete: true });
    } else if (state !== existing) {
      changes.push({ path, content: state });
    }
  }
  return { changes, record };
}
