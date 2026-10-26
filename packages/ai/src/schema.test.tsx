import { blocks, categories } from "@goodfellow-cms/blocks";
import { createPuckConfig } from "@goodfellow-cms/react";
import type { Fields } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { blocksSchema, toContent, toFlatBlocks, toValues, valuesSchema } from "./schema.js";

const config = createPuckConfig({ blocks, categories }, "page");
let counter = 0;
const newId = (type: string) => `${type}-${++counter}`;

// biome-ignore lint/suspicious/noExplicitAny: schemas are read loosely in tests
type Loose = any;

/** Every object in a schema, so tests can check rules that apply to all of them. */
function objects(schema: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(schema)) return schema.flatMap(objects);
  if (!schema || typeof schema !== "object") return [];
  const record = schema as Record<string, unknown>;
  return [...(record.type === "object" ? [record] : []), ...Object.values(record).flatMap(objects)];
}

describe("blocksSchema", () => {
  const schema = blocksSchema(config);

  it("describes every block, with options as enums and slots left out of props", () => {
    const variants = (schema as { properties: { blocks: { items: { anyOf: Array<Record<string, Loose>> } } } })
      .properties.blocks.items.anyOf;
    expect(variants.map((variant) => variant.properties.type.enum[0])).toEqual(Object.keys(config.components));
    const section = variants.find((variant) => variant.properties.type.enum[0] === "Section");
    expect(Object.keys(section?.properties.props.properties)).not.toContain("content");
    expect(section?.properties.props.properties.padding.enum).toEqual(["none", "sm", "md", "lg"]);
    expect(section?.description).toContain('"content"');
  });

  it("follows the structured outputs rules: every object closed and fully required", () => {
    for (const object of objects(schema)) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(Object.keys(object.properties as object));
    }
    expect(JSON.stringify(schema)).not.toContain("$ref");
  });

  it("leaves out fields blocks fill in themselves", () => {
    const template = blocksSchema(createPuckConfig({ blocks, categories }, "template"));
    expect(JSON.stringify(template)).toContain('"EntryField"');
    expect(JSON.stringify(template)).not.toContain('"value"');
  });
});

describe("toContent", () => {
  it("builds nested blocks from the flat list, cleaning props", () => {
    const content = toContent(
      {
        blocks: [
          { type: "Section", id: "s", parent: null, slot: null, props: { padding: "huge", background: "muted" } },
          { type: "Heading", id: "h", parent: "s", slot: "content", props: { text: "Hello", level: "h2", align: 5 } },
          { type: "Text", id: "t", parent: "s", slot: "wrong", props: { content: "<p>Hi</p>" } },
          { type: "Mystery", id: "m", parent: null, slot: null, props: {} },
          { type: "Button", id: "b", parent: "nowhere", slot: "content", props: { label: "Go", href: "/about" } },
        ],
      },
      config,
      newId,
    );

    expect(content.map((block) => block.type)).toEqual(["Section", "Button"]);
    const section = content[0]?.props as Record<string, Loose>;
    expect(section.padding).toBe("md");
    expect(section.background).toBe("muted");
    expect(section.content.map((block: { type: string }) => block.type)).toEqual(["Heading", "Text"]);
    expect(section.content[0].props).toMatchObject({ text: "Hello", level: "h2", align: "left" });
    expect(section.content[0].props.id).toMatch(/^Heading-\d+$/);
    expect(content[1]?.props).toMatchObject({ label: "Go", href: "/about", variant: "primary" });
  });

  it("gives an empty answer for nonsense", () => {
    expect(toContent("nope", config, newId)).toEqual([]);
    expect(toContent({ blocks: [null, 3, { type: 1 }] }, config, newId)).toEqual([]);
  });

  it("round-trips through the flat format", () => {
    const content = toContent(
      {
        blocks: [
          { type: "Grid", id: "g", parent: null, slot: null, props: { columns: "2" } },
          { type: "Heading", id: "a", parent: "g", slot: "items", props: { text: "A" } },
        ],
      },
      config,
      newId,
    );
    const flat = toFlatBlocks(content, config);
    expect(flat.map(({ type, id, parent, slot }) => [type, id, parent, slot])).toEqual([
      ["Grid", "b1", null, null],
      ["Heading", "b2", "b1", "items"],
    ]);
    expect(flat[0]?.props).not.toHaveProperty("items");
    expect(flat[0]?.props).not.toHaveProperty("id");
  });
});

describe("values", () => {
  const fields: Fields = {
    title: { type: "text", label: "Title" },
    date: { type: "custom", label: "Date", render: () => <span />, metadata: { ai: { type: "date" } } },
    kind: {
      type: "custom",
      label: "Kind",
      render: () => <span />,
      metadata: { ai: { type: "choice", options: [{ value: "homily", label: "Homily" }] } },
    },
    topics: {
      type: "custom",
      label: "Topics",
      render: () => <span />,
      metadata: {
        ai: {
          type: "choices",
          options: [
            { value: "music", label: "Music" },
            { value: "youth", label: "Youth" },
          ],
        },
      },
    },
    secret: { type: "custom", label: "Secret", render: () => <span /> },
  };

  it("describes fields, including custom ones that say what they hold", () => {
    const schema = valuesSchema(fields) as { properties: { values: { properties: Record<string, Loose> } } };
    const properties = schema.properties.values.properties;
    expect(Object.keys(properties)).toEqual(["title", "date", "kind", "topics"]);
    expect(properties.kind.enum).toEqual(["", "homily"]);
    expect(properties.topics).toMatchObject({ type: "array", items: { enum: ["music", "youth"] } });
  });

  it("keeps the current value where the answer doesn't fit", () => {
    expect(
      toValues(
        {
          values: { title: "New", date: "next week", kind: "homily", topics: ["youth", "sport", "music"], secret: "x" },
        },
        fields,
        { title: "Old", date: "2026-01-01", secret: "kept" },
      ),
    ).toEqual({ title: "New", date: "2026-01-01", kind: "homily", topics: ["music", "youth"], secret: "kept" });
  });
});

describe("tables", () => {
  it("describes a table's cells as rows of text, and lines rows up", () => {
    const schema = blocksSchema(config) as Loose;
    const table = schema.properties.blocks.items.anyOf.find(
      (variant: Loose) => variant.properties.type.enum[0] === "Table",
    );
    expect(table.properties.props.properties.cells).toMatchObject({
      type: "array",
      items: { type: "array", items: { type: "string" } },
    });
    const content = toContent(
      {
        blocks: [
          {
            id: "t",
            type: "Table",
            props: { cells: [["Day", "Time"], ["Sunday"], "not a row"], header: true },
          },
        ],
      },
      config,
      newId,
    );
    expect(content[0]?.props.cells).toEqual([
      ["Day", "Time"],
      ["Sunday", ""],
    ]);
  });
});
