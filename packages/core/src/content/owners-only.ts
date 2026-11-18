/**
 * Block settings only a site's owners may change, such as the Custom HTML
 * block's "use it exactly as written". A block marks one with
 * `metadata: { owners: true }` on the field. Full-stack sites' servers hold
 * editors to it (`ownersOnlyChanges()` in `appApi()`); elsewhere editors'
 * own accounts can write any file, so it only says what the server checks.
 */
import type { FileChange } from "./store.js";

/** The settings, by block name, that only owners may change, with each block's starting values. */
export interface OwnersOnlyFields {
  [block: string]: { fields: string[]; defaults: Record<string, unknown> };
}

type FieldLike = { metadata?: unknown };
type BlockLike = { fields?: Readonly<Record<string, unknown>>; defaultProps?: unknown };

/** Whether a field is one only owners may change. */
export function isOwnersOnlyField(field: unknown): boolean {
  const metadata = (field as FieldLike | null)?.metadata;
  return typeof metadata === "object" && metadata !== null && (metadata as { owners?: unknown }).owners === true;
}

/** Whether pages leave a setting out where a block's saved props do, rather than give it its default. */
function hasNoDefault(field: unknown): boolean {
  const metadata = (field as FieldLike | null)?.metadata;
  return typeof metadata === "object" && metadata !== null && (metadata as { noDefault?: unknown }).noDefault === true;
}

/** The owners-only settings of a config's blocks, such as `config.blocks`. */
export function ownersOnlyFields(blocks: Readonly<Record<string, BlockLike>>): OwnersOnlyFields {
  const found: OwnersOnlyFields = {};
  for (const [name, block] of Object.entries(blocks)) {
    const fields = Object.entries(block?.fields ?? {})
      .filter(([, field]) => isOwnersOnlyField(field))
      .map(([field]) => field);
    if (fields.length === 0) continue;
    const given = typeof block.defaultProps === "object" && block.defaultProps !== null ? block.defaultProps : {};
    // A setting pages don't give its default (`metadata: { noDefault: true }`) has none here either.
    const defaults = Object.fromEntries(
      Object.entries(given).filter(([field]) => !hasNoDefault(block.fields?.[field])),
    );
    found[name] = { fields, defaults };
  }
  return found;
}

type Block = { type: string; props: Record<string, unknown> };

function isBlock(value: unknown): value is Block {
  const block = value as Block | null;
  return (
    typeof block === "object" &&
    block !== null &&
    typeof block.type === "string" &&
    typeof block.props === "object" &&
    block.props !== null
  );
}

/**
 * Every block anywhere in a content file, by id (pages' blocks, slots, drop
 * zones, headers' and footers'), the ids more than one block has, with every
 * block that has each, which Puck would draw every one of, and the blocks
 * with no id, which it draws too.
 */
function blocksOf(text: string | undefined): {
  blocks: Map<string, Block>;
  repeated: Map<string, Block[]>;
  unnamed: Block[];
} {
  const blocks = new Map<string, Block>();
  const repeated = new Map<string, Block[]>();
  const unnamed: Block[] = [];
  if (text === undefined) return { blocks, repeated, unnamed };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { blocks, repeated, unnamed };
  }
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (typeof value === "object" && value !== null) {
      if (isBlock(value) && typeof value.props.id === "string") {
        const id = value.props.id;
        const earlier = blocks.get(id);
        if (earlier) repeated.set(id, [...(repeated.get(id) ?? [earlier]), value]);
        blocks.set(id, value);
      } else if (isBlock(value)) unnamed.push(value);
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(parsed);
  return { blocks, repeated, unnamed };
}

/** A change's text, for a file sent as bytes too, so sending a page as bytes never skips the check. */
function changedText(change: FileChange): string | undefined {
  if ("delete" in change) return undefined;
  if ("content" in change) return change.content;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(change.bytes);
  } catch {
    return "";
  }
}

/** A value as JSON with its objects' keys in order, so two values that differ only in their keys' order compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

type Owned = OwnersOnlyFields[string];

/**
 * A block's props as pages draw them: its starting values under what it's
 * saved with (`withDefaultProps()` in `@goodfellow-cms/react`'s
 * `preparePage()`), so a setting left out is its starting value here too.
 */
const drawn = (owned: Owned, props: Record<string, unknown>) => ({ ...owned.defaults, ...props });

/** Whether a block's owners-only settings, as pages draw them, are all their starting values. */
const startsAsDefault = (owned: Owned, props: Record<string, unknown>) =>
  owned.fields.every((field) => same(drawn(owned, props)[field], owned.defaults[field]));

/**
 * The files in `changes` where an owners-only setting changed: a block that
 * was there keeps its value, and a new one holds its block's starting value,
 * each read as pages draw them, with a block's starting values under what
 * it's saved with, so a setting left out is its starting value and `null` is
 * a value of its own. A block whose owners-only setting isn't its starting
 * value, such as Custom HTML used exactly as written, is the owners' whole:
 * none of its settings may change, since its HTML would run as written. Two
 * blocks with one id, which Puck would draw both of, count as a change, as
 * does a block with no id, which nothing could compare by id, unless its
 * owners-only settings are their starting values or the file had the same
 * block before. `read` gives a file as it was before the changes.
 */
export async function ownersOnlyChanges(
  changes: readonly FileChange[],
  fields: OwnersOnlyFields,
  read: (path: string) => Promise<string | undefined>,
): Promise<string[]> {
  if (Object.keys(fields).length === 0) return [];
  const changed: string[] = [];
  for (const change of changes) {
    if (!change.path.endsWith(".json")) continue;
    const text = changedText(change);
    if (text === undefined) continue;
    const after = blocksOf(text);
    const protectedBlock = (block: Block) => Object.hasOwn(fields, block.type);
    // Any block of a repeated id counts, not only the last, which another block's type could otherwise hide.
    if ([...after.repeated.values()].some((all) => all.some(protectedBlock))) {
      changed.push(change.path);
      continue;
    }
    const marked = [...after.blocks.entries()].filter(([, block]) => protectedBlock(block));
    const unnamed = after.unnamed.filter(protectedBlock);
    if (marked.length === 0 && unnamed.length === 0) continue;
    const earlier = blocksOf(await read(change.path));
    const before = earlier.blocks;
    const breaks = marked.some(([id, block]) => {
      const owned = fields[block.type] as Owned;
      const was = before.get(id);
      const previous = was?.type === block.type ? was.props : undefined;
      if (!previous) return !startsAsDefault(owned, block.props);
      const now = drawn(owned, block.props);
      const then = drawn(owned, previous);
      if (owned.fields.some((field) => !same(now[field], then[field]))) return true;
      // An owner's block as they set it stays as they left it, every setting of it.
      return !startsAsDefault(owned, previous) && !same(now, then);
    });
    // Each block the file had before stands for one block now, so a copy of an owner's block is a new block.
    const unmatched = [...earlier.unnamed];
    const unnamedBreaks = unnamed.some((block) => {
      const owned = fields[block.type] as Owned;
      if (startsAsDefault(owned, block.props)) return false;
      const now = drawn(owned, block.props);
      const match = unmatched.findIndex((was) => was.type === block.type && same(drawn(owned, was.props), now));
      if (match === -1) return true;
      unmatched.splice(match, 1);
      return false;
    });
    if (breaks || unnamedBreaks) changed.push(change.path);
  }
  return changed;
}
