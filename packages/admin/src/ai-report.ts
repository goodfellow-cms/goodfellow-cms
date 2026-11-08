import type { Fields } from "@puckeditor/core";

/** What an answer changed once it was put in, and what was left out since it didn't fit the site's fields. */
export interface ApplyReport {
  /** Settings or fields whose value changed. */
  settings?: number;
  /** Blocks put in, those inside others included. */
  blocks?: number;
  /** Values and blocks the answer had that were left out. */
  skipped: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Whether an answered value says what the field already held. An object only
 * needs to agree on what it gives, since putting it in keeps the rest: an event
 * answered with its start and end keeps its repeat (`toValues()`). Empty parts,
 * which putting it in leaves out, say nothing, and an object that says nothing
 * at all isn't one the field can hold.
 */
function agrees(given: unknown, before: unknown): boolean {
  if (isRecord(given) && isRecord(before)) {
    const said = Object.entries(given).filter(([, value]) => value !== "" && value !== undefined);
    return said.length > 0 && said.every(([key, value]) => agrees(value, before[key]));
  }
  return same(given, before);
}

/** How many blocks a list holds, counting those in their slots. */
export function countBlocks(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce<number>((total, block) => {
    const props = (block as { props?: unknown } | null)?.props;
    const inside =
      props && typeof props === "object"
        ? Object.values(props).reduce<number>((sum, value) => sum + countBlocks(value), 0)
        : 0;
    return total + (block && typeof block === "object" && "type" in block ? 1 + inside : 0);
  }, 0);
}

/** What putting in an answer's `values` for `fields` changed from `before`, and how many it left out. */
export function valuesReport(
  answered: unknown,
  fields: Fields,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ApplyReport {
  const given = answered && typeof answered === "object" ? (answered as Record<string, unknown>) : {};
  let settings = 0;
  let skipped = 0;
  for (const name of Object.keys(fields)) {
    if (!same(after[name], before[name])) settings++;
    else if (name in given && given[name] !== "" && !agrees(given[name], before[name])) skipped++;
  }
  return { settings, skipped };
}

/** The flat list of blocks an answer gave. */
export function answeredBlocks(answer: unknown): number {
  const blocks = answer && typeof answer === "object" ? (answer as { blocks?: unknown }).blocks : undefined;
  return Array.isArray(blocks) ? blocks.length : 0;
}
