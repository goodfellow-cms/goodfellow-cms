import { describe, expect, it } from "vitest";
import {
  type ComponentInfo,
  choiceLabel,
  componentBlockSource,
  componentDefaults,
  propLabel,
} from "./component-blocks.js";

const button: ComponentInfo = {
  name: "button",
  title: "Button",
  component: "Button",
  from: "@/components/ui/button",
  isDefault: false,
  props: [
    { name: "variant", shape: { kind: "choice", values: ["default", "outline"] }, default: "outline" },
    { name: "size", shape: { kind: "choice", values: ["default", "icon-lg"] } },
  ],
  children: "text",
  className: true,
  section: false,
};

const hero: ComponentInfo = {
  name: "hero",
  title: "Hero",
  component: "Hero",
  from: "@/components/hero",
  isDefault: false,
  props: [
    { name: "heading", shape: { kind: "text" }, default: "Welcome" },
    {
      name: "image",
      shape: {
        kind: "object",
        props: [
          { name: "src", shape: { kind: "text", media: true } },
          { name: "alt", shape: { kind: "text" } },
        ],
      },
      default: { src: "/media/hero.jpg", alt: 3 },
    },
    {
      name: "links",
      shape: { kind: "list", props: [{ name: "text", shape: { kind: "text" } }] },
      default: [{ text: "One" }, { text: 2 }],
    },
    { name: "wide", shape: { kind: "boolean" } },
    { name: "count", shape: { kind: "number" }, default: "three" },
  ],
  className: true,
  section: true,
  notes: ["components/hero.tsx uses <a>."],
};

describe("componentDefaults", () => {
  it("takes the component's own defaults where they fit, and empty ones elsewhere", () => {
    expect(componentDefaults(hero)).toEqual({
      heading: "Welcome",
      image: { src: "/media/hero.jpg", alt: "" },
      links: [{ text: "One" }, { text: "" }],
      wide: false,
      count: 0,
      className: "",
    });
  });

  it("starts choices at the component's default, or the first, and labels buttons with their name", () => {
    expect(componentDefaults(button)).toEqual({
      variant: "outline",
      size: "default",
      children: "Button",
      className: "",
    });
  });
});

describe("labels", () => {
  it("says what props are in words, with better ones for the usual names", () => {
    expect(propLabel("badgeText")).toBe("Badge text");
    expect(propLabel("variant")).toBe("Style");
    expect(propLabel("src")).toBe("Picture");
    expect(choiceLabel("icon-lg")).toBe("Icon lg");
  });
});

describe("componentBlockSource", () => {
  it("wraps a component with the registry blocks' spacing, its words as its label", () => {
    const source = componentBlockSource(button);
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain(
      'type Props = Pick<ComponentProps<typeof Button>, "variant" | "size"> & { children: string; className: string };',
    );
    expect(source).toContain(
      'options: [\n          { label: "Default", value: "default" },\n          { label: "Outline", value: "outline" },\n        ],',
    );
    expect(source).toContain('children: { type: "text", label: "Label", contentEditable: true },');
    expect(source).toContain('<div className={part("gf-button", "mx-auto w-full max-w-3xl px-4 py-4", className)}>');
    expect(source).toContain("<Button variant={variant} size={size}>{children}</Button>");
    expect(source).toContain('{ "gf-button": "Button" },');
  });

  it("gives a section the block's classes itself, with groups, lists and pictures, and notes what's left", () => {
    const source = componentBlockSource(hero);
    expect(source).toContain(
      'import { classNameField, mediaField, useParts, withParts } from "@goodfellow-cms/react";',
    );
    expect(source).toContain('src: mediaField("Picture"),');
    expect(source).toContain('type: "array",');
    expect(source).toContain('defaultItemProps: { text: "" },');
    expect(source).toContain('options: [\n          { label: "Yes", value: true },');
    expect(source).toContain(
      '<Hero heading={heading} image={image} links={links} wide={wide} count={count} className={part("gf-hero", undefined, className)} />',
    );
    expect(source).toContain("// - components/hero.tsx uses <a>.");
    expect(source).not.toContain("<div");
  });

  it("puts a slot's blocks inside the component, and a default export by its name", () => {
    const source = componentBlockSource({
      ...hero,
      name: "panel",
      component: "Panel",
      from: "@/components/panel",
      isDefault: true,
      props: [],
      children: "slot",
      notes: [],
    });
    expect(source).toContain('import Panel from "@/components/panel";');
    expect(source).toContain('import type { ComponentConfig, Slot } from "@puckeditor/core";');
    expect(source).not.toContain("ComponentProps");
    expect(source).toContain("type Props = { children: Slot; className: string };");
    expect(source).toContain("render: ({ children: Children, className }) => {");
    expect(source).toContain(
      '<Panel className={part("gf-panel", undefined, className)}>\n          <Children />\n        </Panel>',
    );
  });
});
