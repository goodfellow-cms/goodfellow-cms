/**
 * Checks what a page editor other than Puck gives back, such as an editor
 * plugin's (`PluginEditor`), before the admin panel publishes it. The plugin
 * may have been written by anyone, so its answer is checked against the
 * site's blocks as its description has them: only the site's blocks, each
 * value fitting its field, and nothing a block doesn't declare unless it was
 * already there when the editor opened, such as a value `resolveData` filled
 * in. Nothing here needs the blocks' code.
 */
import type { ComponentData, Data } from "@puckeditor/core";
import type { PluginEditorKind } from "../plugins.js";
import type { SiteDescription } from "../site-description.js";

/** The longest page an editor may hand back, as JSON. */
export const MAX_EDITED_DATA = 2_000_000;

/** Something wrong with what an editor gave back: where, such as `content[2].props.title`, and what. */
export interface EditedDataProblem {
  path: string;
  message: string;
  /** The block it's in, by its label (else its name), for saying where in words; none for the page's settings. */
  block?: string;
  /** The block's or page's setting it's about, by its label (else its name), where it's about one. */
  field?: string;
}

export type EditedData = { ok: true; data: Data } | { ok: false; problems: EditedDataProblem[] };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type FieldJson = { type?: unknown; label?: unknown; options?: unknown; arrayFields?: unknown; objectFields?: unknown };

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The values a select or radio field offers. */
function optionValues(field: FieldJson): unknown[] {
  return Array.isArray(field.options)
    ? field.options.filter(isObject).map((option) => (option as { value?: unknown }).value)
    : [];
}

/**
 * Notes where a value doesn't fit its field. Fields whose values can't be told
 * from JSON take anything; with `resolves`, for a block whose fields change
 * with what it's set to, a choice can be any plain value, since the choices
 * its description lists are only those it starts with.
 */
function misfit(field: FieldJson, value: Json, path: string, problems: EditedDataProblem[], resolves = false): void {
  const problem = (message: string) => problems.push({ path, message });
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext":
      if (typeof value !== "string") problem("should be text");
      return;
    case "number":
      if (typeof value !== "number") problem("should be a number");
      return;
    case "select":
    case "radio": {
      const offered = optionValues(field);
      const plain = !isObject(value) && !Array.isArray(value);
      if (offered.length > 0 && !resolves ? !offered.some((option) => same(option, value)) : !plain) {
        problem("isn't one of the field's choices");
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        problem("should be a list");
        return;
      }
      const fields = isObject(field.arrayFields) ? (field.arrayFields as Record<string, FieldJson>) : {};
      value.forEach((item, index) => {
        if (!isObject(item)) problems.push({ path: `${path}[${index}]`, message: "should be a set of values" });
        else checkValues(fields, item, `${path}[${index}]`, problems, resolves);
      });
      return;
    }
    case "object":
      if (!isObject(value)) problem("should be a set of values");
      else
        checkValues(
          isObject(field.objectFields) ? (field.objectFields as Record<string, FieldJson>) : {},
          value,
          path,
          problems,
          resolves,
        );
      return;
    default:
      // Custom and external fields, and any Puck adds, hold what their code says.
      return;
  }
}

/** Checks the values inside a list's item or an object field: declared ones must fit; others are kept. */
function checkValues(
  fields: Record<string, FieldJson>,
  values: JsonObject,
  path: string,
  problems: EditedDataProblem[],
  resolves: boolean,
) {
  for (const [name, value] of Object.entries(values)) {
    const field = fields[name];
    if (field && isObject(field)) misfit(field, value, `${path}.${name}`, problems, resolves);
  }
}

interface Context {
  blocks: SiteDescription["blocks"];
  kind: PluginEditorKind;
  /** Each block's props when the editor opened, by id. */
  opened: Map<string, Record<string, unknown>>;
  ids: Set<string>;
  problems: EditedDataProblem[];
}

/**
 * Props a block, or the page's settings, may have: declared ones fitting their
 * fields or as they were when the editor opened, others only as they were.
 */
function checkProps(
  fields: Record<string, FieldJson>,
  props: JsonObject,
  before: Record<string, unknown> | undefined,
  path: string,
  context: Context,
  resolves = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    const field = fields[name];
    const at = `${path}.${name}`;
    if (name === "id") {
      result.id = value;
    } else if (field && isObject(field) && field.type === "slot") {
      if (!Array.isArray(value)) context.problems.push({ path: at, message: "should be a list of blocks" });
      else result[name] = checkBlocks(value, at, context);
    } else if (field && isObject(field)) {
      // What Puck saved is the site's own: a value the editor left alone stays, whatever the field says now.
      if (!(before && Object.hasOwn(before, name) && same(before[name], value))) {
        misfit(field, value, at, context.problems, resolves);
      }
      result[name] = value;
    } else if (before && Object.hasOwn(before, name) && same(before[name], value)) {
      result[name] = value;
    } else {
      context.problems.push({ path: at, message: "isn't one of the block's settings" });
    }
  }
  return result;
}

/**
 * Names the block and setting of the problems found since `from` that don't
 * have them yet, which those in its slots' blocks already do.
 */
function nameProblems(
  context: Context,
  from: number,
  propsPath: string,
  fields: Record<string, FieldJson>,
  block?: string,
): void {
  for (const problem of context.problems.slice(from)) {
    if (problem.block !== undefined || problem.field !== undefined) continue;
    if (block !== undefined) problem.block = block;
    if (!problem.path.startsWith(`${propsPath}.`)) continue;
    const name = /^[^.[]+/.exec(problem.path.slice(propsPath.length + 1))?.[0];
    if (!name || name === "id") continue;
    const label = Object.hasOwn(fields, name) ? fields[name]?.label : undefined;
    problem.field = typeof label === "string" && label ? label : name;
  }
}

function checkBlocks(list: Json[], path: string, context: Context): ComponentData[] {
  const result: ComponentData[] = [];
  list.forEach((item, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(item) || typeof item.type !== "string" || !isObject(item.props)) {
      context.problems.push({ path: at, message: "isn't a block" });
      return;
    }
    const block = Object.hasOwn(context.blocks, item.type) ? context.blocks[item.type] : undefined;
    if (!block || (block.templateOnly && context.kind !== "template")) {
      context.problems.push({ path: at, message: `uses "${item.type}", which isn't one of the site's blocks here` });
      return;
    }
    const id = item.props.id;
    if (typeof id !== "string" || !id) {
      context.problems.push({ path: `${at}.props.id`, message: "should be the block's id" });
      return;
    }
    if (context.ids.has(id)) {
      context.problems.push({ path: `${at}.props.id`, message: `is the same as another block's, "${id}"` });
      return;
    }
    context.ids.add(id);
    const from = context.problems.length;
    const fields = block.fields as Record<string, FieldJson>;
    const props = checkProps(
      fields,
      item.props,
      context.opened.get(id),
      `${at}.props`,
      context,
      block.resolvesFields === true,
    );
    nameProblems(context, from, `${at}.props`, fields, block.label || item.type);
    result.push({ type: item.type, props: props as ComponentData["props"] });
  });
  return result;
}

/** Every block's props in what the editor opened, by id, slots included. */
function openedBlocks(data: Data, description: Pick<SiteDescription, "blocks">): Map<string, Record<string, unknown>> {
  const found = new Map<string, Record<string, unknown>>();
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const block of list as ComponentData[]) {
      const props = block?.props as Record<string, unknown> | undefined;
      if (!props) continue;
      if (typeof props.id === "string") found.set(props.id, props);
      const fields = (description.blocks[block.type]?.fields ?? {}) as Record<string, FieldJson>;
      for (const [name, field] of Object.entries(fields)) if (field?.type === "slot") visit(props[name]);
    }
  };
  visit(data.content);
  return found;
}

/**
 * Checks what an editor gave back for what it opened (`opened`), giving a
 * clean copy to publish, or what's wrong with it. The header and footer have
 * no page settings, and only collections' templates may use template-only
 * blocks.
 */
export function checkEditedData(
  edited: unknown,
  options: { description: Pick<SiteDescription, "blocks" | "root">; kind: PluginEditorKind; opened: Data },
): EditedData {
  const { description, kind, opened } = options;
  let text: string | undefined;
  try {
    text = JSON.stringify(edited);
  } catch {
    text = undefined;
  }
  if (text === undefined) return { ok: false, problems: [{ path: "", message: "isn't data a page can keep" }] };
  if (text.length > MAX_EDITED_DATA) return { ok: false, problems: [{ path: "", message: "is too long to publish" }] };
  // A plain copy: whatever crossed from the editor's frame, only JSON is kept.
  const data = JSON.parse(text) as Json;
  if (!isObject(data) || !Array.isArray(data.content) || (data.root !== undefined && !isObject(data.root))) {
    return { ok: false, problems: [{ path: "", message: "isn't a page's data" }] };
  }
  const context: Context = {
    blocks: description.blocks,
    kind,
    opened: openedBlocks(opened, description),
    ids: new Set(),
    problems: [],
  };
  const rootGiven = isObject(data.root) ? data.root.props : undefined;
  if (rootGiven !== undefined && !isObject(rootGiven)) {
    context.problems.push({ path: "root.props", message: "should be the page's settings" });
  }
  const rootFields =
    kind === "header" || kind === "footer" ? {} : (description.root.fields as Record<string, FieldJson>);
  const rootFrom = context.problems.length;
  const rootProps = checkProps(
    rootFields,
    isObject(rootGiven) ? rootGiven : {},
    (opened.root?.props ?? {}) as Record<string, unknown>,
    "root.props",
    context,
  );
  nameProblems(context, rootFrom, "root.props", rootFields);
  const content = checkBlocks(data.content, "content", context);
  // Puck's older drop zones aren't edited outside Puck: they stay as they were.
  if (data.zones !== undefined && !same(data.zones, opened.zones ?? {})) {
    context.problems.push({ path: "zones", message: "can only be changed in Puck" });
  }
  if (context.problems.length > 0) return { ok: false, problems: context.problems };
  return {
    ok: true,
    data: { root: { props: rootProps }, content, ...(opened.zones && { zones: opened.zones }) } as Data,
  };
}

/**
 * Checks what Puck's frame gives back before it's published. Puck there runs
 * with the site's blocks' code, so its values are trusted as they are, but not
 * its shape: only plain JSON is kept, and every block, in slots and drop zones
 * too, must be one of the site's blocks, template-only ones only in a
 * collection's template.
 */
export function checkPuckData(
  edited: unknown,
  options: { description: Pick<SiteDescription, "blocks">; kind: string },
): EditedData {
  const { description, kind } = options;
  let text: string | undefined;
  try {
    text = JSON.stringify(edited);
  } catch {
    text = undefined;
  }
  if (text === undefined) return { ok: false, problems: [{ path: "", message: "isn't data a page can keep" }] };
  if (text.length > MAX_EDITED_DATA) return { ok: false, problems: [{ path: "", message: "is too long to publish" }] };
  const data = JSON.parse(text) as Json;
  if (!isObject(data) || !Array.isArray(data.content) || (data.root !== undefined && !isObject(data.root))) {
    return { ok: false, problems: [{ path: "", message: "isn't a page's data" }] };
  }
  const problems: EditedDataProblem[] = [];
  const visit = (list: Json, path: string) => {
    if (!Array.isArray(list)) {
      problems.push({ path, message: "should be a list of blocks" });
      return;
    }
    list.forEach((item, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(item) || typeof item.type !== "string" || !isObject(item.props)) {
        problems.push({ path: at, message: "isn't a block" });
        return;
      }
      const block = Object.hasOwn(description.blocks, item.type) ? description.blocks[item.type] : undefined;
      if (!block || (block.templateOnly && kind !== "template")) {
        problems.push({ path: at, message: `uses "${item.type}", which isn't one of the site's blocks here` });
        return;
      }
      const fields = block.fields as Record<string, FieldJson>;
      for (const [name, field] of Object.entries(fields)) {
        const value = item.props[name];
        if (field?.type === "slot" && value !== undefined) visit(value, `${at}.props.${name}`);
      }
    });
  };
  visit(data.content, "content");
  if (data.zones !== undefined) {
    if (!isObject(data.zones)) problems.push({ path: "zones", message: "should be the page's drop zones" });
    else for (const [zone, list] of Object.entries(data.zones)) visit(list, `zones.${zone}`);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, data: data as unknown as Data };
}
