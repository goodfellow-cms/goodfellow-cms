/**
 * Synced blocks: blocks kept once, in `content/synced-blocks/<name>.json`,
 * which pages, collections' templates, headers and footers place with the
 * SyncedBlock block (`SYNCED_BLOCK`), naming it by its `block` prop. Where
 * pages are built, each placement is put in place of the SyncedBlock block
 * with ids of its own (`expandSyncedBlocks()`), so changing the synced block
 * changes every page in one publish. A synced block can't place another, so
 * nothing loops.
 */
import type { SiteContent, SyncedBlock } from "./load.js";
import { FOOTER_FILE, HEADER_FILE, languageLayoutFile } from "./paths.js";
import type { SyncedBlockFile } from "./schemas.js";

/** The block that places a synced block, which content names it by. Never rename it. */
export const SYNCED_BLOCK = "SyncedBlock";

/** The prop of `SYNCED_BLOCK` that names the synced block it places. */
export const SYNCED_BLOCK_PROP = "block";

interface Component {
  type: string;
  props: Record<string, unknown>;
}

function isComponent(value: unknown): value is Component {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Component).type === "string" &&
    typeof (value as Component).props === "object" &&
    (value as Component).props !== null
  );
}

/** The synced block a SyncedBlock block names, or `undefined` for any other block. */
export function placedSyncedBlock(value: unknown): string | undefined {
  if (!isComponent(value) || value.type !== SYNCED_BLOCK) return undefined;
  const name = value.props[SYNCED_BLOCK_PROP];
  return typeof name === "string" ? name : "";
}

/** The names of every synced block placed anywhere in some content, such as a page's data. */
export function placedSyncedBlocks(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!item || typeof item !== "object") return;
    const name = placedSyncedBlock(item);
    if (name !== undefined) found.add(name);
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return [...found];
}

/** A synced block by name. */
export function findSyncedBlock(content: Pick<SiteContent, "syncedBlocks">, name: string): SyncedBlock | undefined {
  return content.syncedBlocks?.find((block) => block.name === name);
}

/** A synced block as a language shows it: its own there, else the main language's. */
export function syncedBlockIn(block: SyncedBlock, language: string | undefined): SyncedBlockFile {
  return (language && block.languages?.[language]?.content) || block.content;
}

/** Where a synced block is placed, so it isn't deleted from under them. */
export type SyncedBlockUse =
  | { kind: "page"; path: string; file: string; title?: string }
  | { kind: "template"; collection: string; name: string; file: string }
  | { kind: "header" | "footer"; file: string; language?: string };

/** Every page, template, header and footer that places a synced block. */
export function syncedBlockUses(content: SiteContent, name: string): SyncedBlockUse[] {
  const uses: SyncedBlockUse[] = [];
  const places = (data: unknown) => placedSyncedBlocks(data).includes(name);
  for (const page of content.pages) {
    if (!places(page.content.data)) continue;
    const title = (page.content.data.root?.props as { title?: unknown } | undefined)?.title;
    uses.push({ kind: "page", path: page.path, file: page.file, ...(typeof title === "string" && title && { title }) });
  }
  for (const collection of content.collections) {
    if (places(collection.settings.template)) {
      uses.push({ kind: "template", collection: collection.id, name: collection.settings.name, file: collection.file });
    }
  }
  if (places(content.header.data)) uses.push({ kind: "header", file: HEADER_FILE });
  if (places(content.footer.data)) uses.push({ kind: "footer", file: FOOTER_FILE });
  for (const [language, layouts] of Object.entries(content.languageLayouts ?? {})) {
    for (const part of ["header", "footer"] as const) {
      if (layouts[part] && places(layouts[part]?.data)) {
        uses.push({ kind: part, language, file: languageLayoutFile(part, language) });
      }
    }
  }
  return uses;
}

/** Problems with how synced blocks are placed, for the site checks. */
export type SyncedBlockProblem =
  /** A SyncedBlock block naming a synced block the site doesn't have, or none. */
  | { kind: "missing-synced-block"; file: string; target: string }
  /** A synced block that places a synced block, which isn't allowed, so nothing loops. */
  | { kind: "nested-synced-block"; file: string; target: string };

/** Every file whose SyncedBlock blocks name a synced block that isn't there, and every synced block that places one. */
export function syncedBlockProblems(content: SiteContent): SyncedBlockProblem[] {
  const names = new Set((content.syncedBlocks ?? []).map((block) => block.name));
  const problems: SyncedBlockProblem[] = [];
  const check = (file: string, data: unknown) => {
    for (const name of placedSyncedBlocks(data)) {
      if (!names.has(name)) problems.push({ kind: "missing-synced-block", file, target: name });
    }
  };
  for (const page of content.pages) check(page.file, page.content.data);
  for (const collection of content.collections) check(collection.file, collection.settings.template);
  check(HEADER_FILE, content.header.data);
  check(FOOTER_FILE, content.footer.data);
  for (const [language, layouts] of Object.entries(content.languageLayouts ?? {})) {
    for (const part of ["header", "footer"] as const) {
      if (layouts[part]) check(languageLayoutFile(part, language), layouts[part]?.data);
    }
  }
  for (const block of content.syncedBlocks ?? []) {
    const files = [{ file: block.file, content: block.content }, ...Object.values(block.languages ?? {})];
    for (const { file, content: own } of files) {
      for (const name of placedSyncedBlocks(own.data)) {
        problems.push({ kind: "nested-synced-block", file, target: name });
      }
    }
  }
  return problems;
}

/** Ids a placement's copies get, so each placement's blocks have ids of their own: `<placement>-<id>`. */
function withPlacementIds(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => withPlacementIds(item, prefix));
  if (!value || typeof value !== "object") return value;
  if (isComponent(value)) {
    const props: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(value.props)) {
      props[key] = key === "id" && typeof prop === "string" ? `${prefix}-${prop}` : withPlacementIds(prop, prefix);
    }
    return { ...value, props };
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withPlacementIds(item, prefix)]));
}

/**
 * Puck data with every SyncedBlock block replaced by the blocks it places, in
 * the language given, each with ids of its own. A synced block that isn't
 * there, or one placed inside a synced block, leaves nothing. Blocks are
 * found by their shape, in slots, drop zones and arrays alike, so no block's
 * fields are needed.
 */
export function expandSyncedBlocks<T>(data: T, content: Pick<SiteContent, "syncedBlocks">, language?: string): T {
  if (!content.syncedBlocks?.length) return data;
  // Inside a synced block's own blocks, SyncedBlock blocks leave nothing, so nothing loops.
  const expand = (value: unknown, inside: boolean): unknown => {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const name = placedSyncedBlock(item);
        if (name === undefined) return [expand(item, inside)];
        const block = name && !inside ? findSyncedBlock(content, name) : undefined;
        if (!block) return [];
        const placement = String((item as Component).props.id ?? name);
        const placed = syncedBlockIn(block, language).data.content as unknown[];
        return expand(withPlacementIds(placed, placement), true) as unknown[];
      });
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, inside)]));
  };
  return expand(data, false) as T;
}
