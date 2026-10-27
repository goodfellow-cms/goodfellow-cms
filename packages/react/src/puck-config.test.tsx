import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import {
  blockIcon,
  blockKeywords,
  classNameField,
  createPuckConfig,
  describeSite,
  templateOnly,
  withClassName,
  withIcon,
  withKeywords,
} from "./puck-config.js";

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
      "noIndex",
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

  it("opens the built-in groups that fit what's edited, and leaves the site's own and its choices as they are", () => {
    const config = {
      blocks: { Plain: plain },
      categories: {
        layout: { title: "Layout", components: ["Plain"] },
        navigation: { title: "Navigation", components: [] },
        collections: { title: "Collections", components: [], defaultExpanded: true },
        mine: { title: "Mine", components: [] },
      },
    };
    const open = (kind: "page" | "layout" | "template") =>
      Object.fromEntries(
        Object.entries(createPuckConfig(config, kind).categories ?? {}).map(([key, category]) => [
          key,
          category?.defaultExpanded,
        ]),
      );
    expect(open("page")).toEqual({ layout: true, navigation: false, collections: true, mine: undefined });
    expect(open("layout")).toEqual({ layout: true, navigation: true, collections: true, mine: undefined });
  });
});

describe("block keywords", () => {
  it("are kept on the block and carried in the site's description", () => {
    const Divider = withKeywords({ ...plain }, ["line", "rule"]);
    expect(blockKeywords(Divider)).toEqual(["line", "rule"]);
    expect(describeSite({ blocks: { Divider, Plain: plain } }).blocks).toMatchObject({
      Divider: { keywords: ["line", "rule"] },
    });
    expect(describeSite({ blocks: { Plain: plain } }).blocks.Plain?.keywords).toBeUndefined();
  });
});

describe("block icons", () => {
  it("are kept on the block, cleaned, and carried in the site's description", () => {
    const Divider = withIcon({ ...plain }, [
      ["path", { d: "M5 12h14", key: "1ays0h" }],
      ["image", { href: "https://example.org/a.png" }],
    ]);
    expect(blockIcon(Divider)).toEqual([["path", { d: "M5 12h14" }]]);
    expect(describeSite({ blocks: { Divider, Plain: plain } }).blocks).toMatchObject({
      Divider: { icon: [["path", { d: "M5 12h14" }]] },
    });
    expect(describeSite({ blocks: { Plain: plain } }).blocks.Plain?.icon).toBeUndefined();
    expect(blockIcon(withIcon({ ...plain }, "not an icon"))).toBeUndefined();
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
    expect(description.claude).toBeUndefined();
  });

  it("says when the site's config doesn't let Claude publish", () => {
    expect(describeSite({ blocks: {}, claude: { publish: false } }).claude).toEqual({ publish: false });
    expect(describeSite({ blocks: {}, claude: { publish: true } }).claude).toBeUndefined();
  });
});
