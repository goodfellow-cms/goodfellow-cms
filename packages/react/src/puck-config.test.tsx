import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { classNameField, createPuckConfig, describeSite, templateOnly, withClassName } from "./puck-config.js";

const plain: ComponentConfig<{ text: string }> = {
  fields: { text: { type: "text" } },
  render: ({ text }) => <p>{text}</p>,
};

describe("withClassName", () => {
  it("adds a CSS classes field", () => {
    expect(withClassName(plain).fields?.className).toBe(classNameField);
  });

  it("leaves blocks that handle className themselves alone", () => {
    const own: ComponentConfig<{ className: string }> = {
      fields: { className: classNameField },
      render: ({ className }) => <p className={className} />,
    };
    expect(withClassName(own)).toBe(own);
  });

  it("keeps the field when the block resolves its own fields", async () => {
    const dynamic = withClassName({ ...plain, resolveFields: async () => ({ text: { type: "textarea" } }) });
    // biome-ignore lint/suspicious/noExplicitAny: params aren't used by this resolver
    const fields = await dynamic.resolveFields?.({ props: { id: "x" } } as any, {} as any);
    expect(Object.keys(fields ?? {})).toEqual(["text", "className"]);
  });
});

describe("createPuckConfig", () => {
  it("gives pages their settings and the layout none", () => {
    const config = { blocks: { Plain: plain } };
    expect(Object.keys(createPuckConfig(config, "page").root?.fields ?? {})).toEqual([
      "title",
      "description",
      "image",
      "className",
    ]);
    expect(createPuckConfig(config, "layout").root?.fields).toEqual({});
  });

  it("offers template-only blocks in templates alone", () => {
    const config = {
      blocks: { Plain: plain, Field: templateOnly({ ...plain }) },
      categories: { all: { title: "All", components: ["Plain", "Field"] } },
    };
    const page = createPuckConfig(config, "page");
    const template = createPuckConfig(config, "template");
    expect(Object.keys(page.components)).toEqual(["Plain"]);
    expect(page.categories?.all?.components).toEqual(["Plain"]);
    expect(Object.keys(template.components)).toEqual(["Plain", "Field"]);
    expect(Object.keys(template.root?.fields ?? {})).toContain("title");
  });
});

describe("describeSite", () => {
  it("describes each block's fields as JSON, without their code", () => {
    const description = describeSite({
      blocks: {
        Heading: {
          label: "Heading",
          fields: {
            text: { type: "text", label: "Text" },
            size: { type: "select", label: "Size", options: [{ label: "Large", value: "lg" }] },
            when: { type: "custom", label: "Date", render: () => <span />, metadata: { ai: { type: "date" } } },
          },
          defaultProps: { text: "Heading", size: "lg" },
          render: () => <span />,
        },
        Field: templateOnly({ fields: { field: { type: "text" } }, render: () => <span /> }),
      },
    });
    expect(description).toMatchObject({ version: 1, content: { page: 1, entry: 1 } });
    expect(description.goodfellow).toMatch(/^\d+\.\d+\.\d+/);
    expect(description.root.fields).toMatchObject({ title: { type: "text", label: "Page title" } });
    expect(description.blocks).toEqual({
      Heading: {
        label: "Heading",
        fields: {
          text: { type: "text", label: "Text" },
          size: { type: "select", label: "Size", options: [{ label: "Large", value: "lg" }] },
          when: { type: "custom", label: "Date", metadata: { ai: { type: "date" } } },
          className: { type: "text", label: "CSS classes" },
        },
        defaultProps: { text: "Heading", size: "lg" },
      },
      Field: {
        fields: { field: { type: "text" }, className: { type: "text", label: "CSS classes" } },
        templateOnly: true,
      },
    });
  });
});
