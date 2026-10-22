import type { ComponentConfig, ComponentData, Config, Content, Field, Fields } from "@puckeditor/core";

/** A JSON Schema, in the subset structured outputs accept: no recursion, `additionalProperties: false` everywhere. */
export type JsonSchema = { [key: string]: unknown };

/**
 * How to describe a custom field to the AI, since Puck's custom fields don't
 * say what they hold. Set it as `metadata: { ai: … }` on the field.
 */
export interface AiFieldHint {
  type: "string" | "number" | "date" | "choice" | "choices";
  /** The choices, for `choice` (one of them) and `choices` (any number of them). */
  options?: Array<{ value: string; label: string }>;
  description?: string;
}

export const RICH_TEXT_HINT =
  "Formatted text as simple HTML: <p>, <h2>, <h3>, <strong>, <em>, <a href>, <ul>, <ol>, <li> and <blockquote> only.";

// biome-ignore lint/suspicious/noExplicitAny: Puck fields hold any value
type AnyField = Field<any>;
// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
type AnyComponent = ComponentConfig<any>;

function hintOf(field: AnyField): AiFieldHint | undefined {
  const hint = (field.metadata as { ai?: AiFieldHint } | undefined)?.ai;
  return hint && typeof hint === "object" ? hint : undefined;
}

type OptionValue = string | number | boolean;

function optionValues(field: AnyField): OptionValue[] {
  if (field.type !== "select" && field.type !== "radio") return [];
  return field.options
    .map((option) => option.value)
    .filter((value): value is OptionValue => ["string", "number", "boolean"].includes(typeof value));
}

function describe(field: AnyField, extra?: string): string | undefined {
  const parts = [field.label, extra].filter(Boolean);
  return parts.length > 0 ? parts.join(". ") : undefined;
}

function withDescription(schema: JsonSchema, description: string | undefined): JsonSchema {
  return description ? { ...schema, description } : schema;
}

/** The schema for one field's value, or `undefined` for fields the AI doesn't fill in (slots, external data). */
export function fieldSchema(field: AnyField): JsonSchema | undefined {
  switch (field.type) {
    case "text": {
      const media = (field.metadata as { media?: unknown } | undefined)?.media;
      const hint =
        media === "image"
          ? "The address of one of the site's images, or empty"
          : media === "video"
            ? "The address of one of the site's uploaded videos, or empty"
            : media === "file"
              ? "The address of one of the site's files, or empty"
              : undefined;
      return withDescription({ type: "string" }, describe(field, hint));
    }
    case "textarea":
      return withDescription({ type: "string" }, describe(field, "Plain text; line breaks allowed"));
    case "richtext":
      return withDescription({ type: "string" }, describe(field, RICH_TEXT_HINT));
    case "number":
      return withDescription({ type: "number" }, describe(field));
    case "select":
    case "radio": {
      const values = optionValues(field);
      if (values.length === 0) return withDescription({ type: "string" }, describe(field));
      const labels = field.options
        .map((option) => `${JSON.stringify(option.value)} means "${option.label}"`)
        .join(", ");
      return withDescription({ enum: values }, describe(field, labels));
    }
    case "array": {
      const item = objectSchema(field.arrayFields as Fields);
      return item && withDescription({ type: "array", items: item }, describe(field));
    }
    case "object": {
      const object = objectSchema(field.objectFields as Fields);
      return object && withDescription(object, describe(field));
    }
    case "custom": {
      const hint = hintOf(field);
      if (!hint) return undefined;
      const description = describe(field, hint.description);
      if (hint.type === "number") return withDescription({ type: "number" }, description);
      if (hint.type === "date")
        return withDescription({ type: "string" }, describe(field, "A date written as YYYY-MM-DD, or empty"));
      if (hint.type === "choice" && hint.options?.length) {
        return withDescription({ enum: ["", ...hint.options.map((option) => option.value)] }, description);
      }
      if (hint.type === "choices" && hint.options?.length) {
        const labels = hint.options
          .map((option) => `${JSON.stringify(option.value)} means "${option.label}"`)
          .join(", ");
        return withDescription(
          { type: "array", items: { enum: hint.options.map((option) => option.value) } },
          describe(field, [hint.description, `Any number of: ${labels}`].filter(Boolean).join(". ")),
        );
      }
      return withDescription({ type: "string" }, description);
    }
    default:
      return undefined;
  }
}

/** A schema for an object with these fields. Every field is required, as strict structured outputs demand. */
export function objectSchema(fields: Fields | undefined): JsonSchema | undefined {
  const properties = Object.fromEntries(
    Object.entries(fields ?? {}).flatMap(([name, field]) => {
      // Hidden fields are filled in by the block itself, such as an Entry field's value.
      if ((field as AnyField).visible === false) return [];
      const schema = fieldSchema(field as AnyField);
      return schema ? [[name, schema]] : [];
    }),
  );
  const names = Object.keys(properties);
  if (names.length === 0) return undefined;
  return { type: "object", properties, required: names, additionalProperties: false };
}

export const EMPTY_OBJECT: JsonSchema = { type: "object", properties: {}, required: [], additionalProperties: false };

/** The names of a block's slot fields: the places other blocks go inside it. */
export function slotNames(component: AnyComponent | undefined): string[] {
  return Object.entries(component?.fields ?? {})
    .filter(([, field]) => (field as AnyField).type === "slot")
    .map(([name]) => name);
}

function blockVariant(name: string, component: AnyComponent): JsonSchema {
  const slots = slotNames(component);
  const label = component.label ?? name;
  return {
    type: "object",
    description: slots.length
      ? `${label}. Other blocks go inside it, in: ${slots.map((slot) => `"${slot}"`).join(", ")}.`
      : `${label}.`,
    properties: {
      type: { enum: [name] },
      id: { type: "string", description: "A short id, unique in this answer, such as b1." },
      parent: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "The id of the block this one is inside, listed earlier. null for the top level.",
      },
      slot: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Which part of the parent block this one goes in. null for the top level.",
      },
      props: objectSchema(component.fields as Fields) ?? EMPTY_OBJECT,
    },
    required: ["type", "id", "parent", "slot", "props"],
    additionalProperties: false,
  };
}

/**
 * The schema for blocks the AI writes. Structured outputs can't describe
 * nesting directly, since the schema can't refer to itself, so blocks come as a
 * flat list where each names the block it's inside. `toContent` builds Puck's
 * tree from it.
 */
export function blocksSchema(config: Config): JsonSchema {
  const variants = Object.entries(config.components).map(([name, component]) =>
    blockVariant(name, component as AnyComponent),
  );
  return {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        description: "The blocks, in page order. A block that goes inside another is listed after it.",
        items: { anyOf: variants },
      },
    },
    required: ["blocks"],
    additionalProperties: false,
  };
}

/** The schema for filling in a set of fields, such as an entry's. */
export function valuesSchema(fields: Fields): JsonSchema {
  return {
    type: "object",
    properties: { values: objectSchema(fields) ?? EMPTY_OBJECT },
    required: ["values"],
    additionalProperties: false,
  };
}

/** One block as the AI writes it. */
export interface FlatBlock {
  type: string;
  id: string;
  parent: string | null;
  slot: string | null;
  props: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a value fits a field, so a mistake by the AI can't put the wrong kind of value in a prop. */
function cleanValue(field: AnyField, value: unknown): { ok: true; value: unknown } | { ok: false } {
  switch (field.type) {
    case "text":
    case "textarea":
    case "richtext":
      return typeof value === "string" ? { ok: true, value } : { ok: false };
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false };
    case "select":
    case "radio": {
      const values = optionValues(field);
      if (values.length === 0) return typeof value === "string" ? { ok: true, value } : { ok: false };
      return values.includes(value as OptionValue) ? { ok: true, value } : { ok: false };
    }
    case "array": {
      if (!Array.isArray(value)) return { ok: false };
      const items = value
        .filter(isRecord)
        .map((item) => cleanProps(field.arrayFields as Fields, item, field.defaultItemProps));
      return { ok: true, value: items };
    }
    case "object":
      return isRecord(value) ? { ok: true, value: cleanProps(field.objectFields as Fields, value, {}) } : { ok: false };
    case "custom": {
      const hint = hintOf(field);
      if (!hint) return { ok: false };
      if (hint.type === "number") {
        return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : { ok: false };
      }
      if (hint.type === "choices") {
        if (!Array.isArray(value)) return { ok: false };
        const offered = (hint.options ?? []).map((option) => option.value);
        const tags = offered.filter((option) => value.includes(option));
        return { ok: true, value: tags.length > 0 ? tags : undefined };
      }
      if (typeof value !== "string") return { ok: false };
      if (hint.type === "date" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
      if (hint.type === "choice" && value !== "" && !hint.options?.some((option) => option.value === value)) {
        return { ok: false };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false };
  }
}

/**
 * Keeps the values that fit their fields, falling back to `defaults` for the
 * rest. Free AI services don't always follow the schema, so nothing is
 * trusted as given.
 */
export function cleanProps(
  fields: Fields | undefined,
  value: unknown,
  defaults: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const given = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields ?? {})) {
    if ((field as AnyField).type === "slot" || (field as AnyField).visible === false) continue;
    const cleaned = name in given ? cleanValue(field as AnyField, given[name]) : ({ ok: false } as const);
    if (cleaned.ok) result[name] = cleaned.value;
    else if (defaults && name in defaults) result[name] = structuredClone(defaults[name]);
  }
  return result;
}

/**
 * Turns the AI's flat list of blocks into Puck content, with new ids. Blocks of
 * unknown types are dropped, and a block whose parent or slot doesn't exist goes
 * at the top level, so a confused answer still gives usable content.
 */
export function toContent(answer: unknown, config: Config, newId: (type: string) => string): Content {
  const list = isRecord(answer) && Array.isArray(answer.blocks) ? answer.blocks : [];
  const roots: ComponentData[] = [];
  const byId = new Map<string, ComponentData>();

  for (const item of list) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    const component = config.components[item.type] as AnyComponent | undefined;
    if (!component) continue;

    const slots = slotNames(component);
    const props: Record<string, unknown> = {
      ...cleanProps(component.fields as Fields, item.props, component.defaultProps),
      ...Object.fromEntries(slots.map((slot) => [slot, []])),
      id: newId(item.type),
    };
    const block: ComponentData = { type: item.type, props: props as ComponentData["props"] };

    const parent = typeof item.parent === "string" ? byId.get(item.parent) : undefined;
    const parentSlots = slotNames(parent && (config.components[parent.type] as AnyComponent));
    const slot = typeof item.slot === "string" && parentSlots.includes(item.slot) ? item.slot : parentSlots[0];
    if (parent && slot) (parent.props[slot] as ComponentData[]).push(block);
    else roots.push(block);

    if (typeof item.id === "string" && !byId.has(item.id)) byId.set(item.id, block);
  }
  return roots;
}

/** Puck content as the AI's flat list of blocks, to show it what's there now. Ids are shortened to b1, b2… */
export function toFlatBlocks(content: Content, config: Config): FlatBlock[] {
  const result: FlatBlock[] = [];
  const visit = (blocks: Content, parent: string | null, slot: string | null) => {
    for (const block of blocks) {
      const id = `b${result.length + 1}`;
      const component = config.components[block.type] as AnyComponent | undefined;
      const slots = slotNames(component);
      const props = Object.fromEntries(
        Object.entries(block.props).filter(([name]) => name !== "id" && !slots.includes(name)),
      );
      result.push({ type: block.type, id, parent, slot, props });
      for (const name of slots) {
        const children = block.props[name];
        if (Array.isArray(children)) visit(children as Content, id, name);
      }
    }
  };
  visit(content, null, null);
  return result;
}

/** The AI's values for a set of fields, keeping `current` for any it got wrong or left out. */
export function toValues(answer: unknown, fields: Fields, current: Record<string, unknown>): Record<string, unknown> {
  const values = isRecord(answer) ? answer.values : undefined;
  return { ...current, ...cleanProps(fields, values, current) };
}
