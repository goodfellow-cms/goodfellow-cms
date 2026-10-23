import { type Collection, type Entry, scheduleOf } from "@goodfellow-cms/core";

/**
 * Where the item's schedule is among the values Puck edits. Fields' names are
 * lowercase letters, numbers and hyphens, so none can have this one.
 */
export const SCHEDULE_PROP = "_schedule";

/** The values Puck edits: the entry's stored values, with every field present so Puck shows it, and its schedule. */
export function formValues(collection: Collection, entry: Entry): Record<string, unknown> {
  const values: Record<string, unknown> = { ...entry.content.fields };
  for (const field of collection.settings.fields) {
    if (values[field.name] === undefined && field.type !== "number") values[field.name] = "";
  }
  values[SCHEDULE_PROP] = scheduleOf(entry.content);
  return values;
}
