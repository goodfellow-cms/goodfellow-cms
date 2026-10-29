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

/** The owners-only settings of a config's blocks, such as `config.blocks`. */
export function ownersOnlyFields(blocks: Readonly<Record<string, BlockLike>>): OwnersOnlyFields {
  const found: OwnersOnlyFields = {};
  for (const [name, block] of Object.entries(blocks)) {
    const fields = Object.entries(block?.fields ?? {})
      .filter(([, field]) => isOwnersOnlyField(field))
      .map(([field]) => field);
    if (fields.length === 0) continue;
    const defaults = typeof block.defaultProps === "object" && block.defaultProps !== null ? block.defaultProps : {};
    found[name] = { fields, defaults: defaults as Record<string, unknown> };
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

/** Every block anywhere in a content file, by id: pages' blocks, slots, drop zones, headers' and footers'. */
function blocksOf(text: string | undefined): Map<string, Block> {
  const found = new Map<string, Block>();
  if (text === undefined) return found;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return found;
  }
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (typeof value === "object" && value !== null) {
      if (isBlock(value) && typeof value.props.id === "string") found.set(value.props.id, value);
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(parsed);
  return found;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The files in `changes` where an owners-only setting changed: a block that
 * was there keeps its value, and a new one keeps its block's starting value.
 * `read` gives a file as it was before the changes.
 */
export async function ownersOnlyChanges(
  changes: readonly FileChange[],
  fields: OwnersOnlyFields,
  read: (path: string) => Promise<string | undefined>,
): Promise<string[]> {
  if (Object.keys(fields).length === 0) return [];
  const changed: string[] = [];
  for (const change of changes) {
    if (!("content" in change) || typeof change.content !== "string" || !change.path.endsWith(".json")) continue;
    const after = blocksOf(change.content);
    const marked = [...after.entries()].filter(([, block]) => Object.hasOwn(fields, block.type));
    if (marked.length === 0) continue;
    const before = blocksOf(await read(change.path));
    const breaks = marked.some(([id, block]) => {
      const owned = fields[block.type];
      if (!owned) return false;
      const was = before.get(id);
      const previous = was?.type === block.type ? was.props : {};
      return owned.fields.some(
        (field) => !same(block.props[field] ?? owned.defaults[field], previous[field] ?? owned.defaults[field]),
      );
    });
    if (breaks) changed.push(change.path);
  }
  return changed;
}
