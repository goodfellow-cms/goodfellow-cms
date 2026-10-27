/**
 * Blocks written from React components' props, for `goodfellow blocks add`:
 * what a component takes, read from its code elsewhere (`node-shadcn.ts`),
 * becomes a block's fields, defaults and source. Nothing here reads files or
 * TypeScript, so what a component gives can be tested on its own.
 */

/** What a prop holds, in the terms a block's fields can show. */
export type PropShape =
  | { kind: "choice"; values: string[] }
  | { kind: "boolean" }
  | { kind: "text"; media?: boolean }
  | { kind: "number" }
  | { kind: "object"; props: ComponentProp[] }
  | { kind: "list"; props: ComponentProp[] };

export interface ComponentProp {
  name: string;
  shape: PropShape;
  /** The component's own default, from its code, if it has one that fits. */
  default?: unknown;
}

/** A component to make a block of, as read from its code. */
export interface ComponentInfo {
  /** The block's name, its key in content: the registry item's. */
  name: string;
  /** What owners see it called. */
  title: string;
  /** What it's imported as, from where, and whether it's the module's default export. */
  component: string;
  from: string;
  isDefault: boolean;
  /** The props that become fields, in the order the component declares them. */
  props: ComponentProp[];
  /** Its children, as words (a button's label) or as blocks inside it. */
  children?: "text" | "slot";
  /** Whether it takes `className`, which then carries the block's. */
  className: boolean;
  /**
   * A page section brings its own spacing, as shadcn's blocks do; a component
   * such as a button is put in a wrapper with the registry blocks' spacing.
   */
  section: boolean;
  /** Notes for the block's file, on what was left for a developer to do. */
  notes?: string[];
}

/** What a field is called, for people who don't read code: `badgeText` → "Badge text". */
export function propLabel(name: string): string {
  const named = PROP_LABELS[name];
  if (named) return named;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PROP_LABELS: Record<string, string> = {
  variant: "Style",
  src: "Picture",
  srcDark: "Picture in dark mode",
  alt: "Description of the picture",
  url: "Link",
  href: "Link",
  link: "Link",
};

/** A choice's name for owners: `icon-lg` → "Icon lg". */
export function choiceLabel(value: string): string {
  return propLabel(value);
}

/** The classes of the wrapper components get, as the registry's blocks have. */
export const COMPONENT_SPACING = "mx-auto w-full max-w-3xl px-4 py-4";

/** Code to put in the source as it is, such as a call. */
class Code {
  constructor(readonly text: string) {}
}

function fieldValue(prop: ComponentProp): unknown {
  const label = propLabel(prop.name);
  const { shape } = prop;
  switch (shape.kind) {
    case "choice":
      return {
        type: "select",
        label,
        options: shape.values.map((value) => ({ label: choiceLabel(value), value })),
      };
    case "boolean":
      return {
        type: "radio",
        label,
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      };
    case "text":
      return shape.media ? new Code(`mediaField(${JSON.stringify(label)})`) : { type: "text", label };
    case "number":
      return { type: "number", label };
    case "object":
      return { type: "object", label, objectFields: fieldsOf(shape.props) };
    case "list":
      return {
        type: "array",
        label,
        arrayFields: fieldsOf(shape.props),
        defaultItemProps: defaultsOf(shape.props),
      };
  }
}

function fieldsOf(props: readonly ComponentProp[]): Record<string, unknown> {
  return Object.fromEntries(props.map((prop) => [prop.name, fieldValue(prop)]));
}

/** A value of a prop where the component's code gives none. */
function emptyValue(shape: PropShape): unknown {
  switch (shape.kind) {
    case "choice":
      return shape.values[0];
    case "boolean":
      return false;
    case "text":
      return "";
    case "number":
      return 0;
    case "object":
      return defaultsOf(shape.props);
    case "list":
      return [];
  }
}

/** A value that fits the prop's shape, or `undefined`. */
function fitting(shape: PropShape, value: unknown): unknown {
  switch (shape.kind) {
    case "choice":
      return typeof value === "string" && shape.values.includes(value) ? value : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "text":
      return typeof value === "string" ? value : undefined;
    case "number":
      return typeof value === "number" ? value : undefined;
    case "object":
      return value && typeof value === "object" && !Array.isArray(value)
        ? defaultsOf(shape.props, value as Record<string, unknown>)
        : undefined;
    case "list":
      return Array.isArray(value)
        ? value.map((item) =>
            defaultsOf(shape.props, item && typeof item === "object" ? (item as Record<string, unknown>) : {}),
          )
        : undefined;
  }
}

function defaultsOf(props: readonly ComponentProp[], given: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    props.map((prop) => [
      prop.name,
      fitting(prop.shape, prop.name in given ? given[prop.name] : prop.default) ?? emptyValue(prop.shape),
    ]),
  );
}

/** The block's default props: the component's own defaults where its code has them, else empty ones. */
export function componentDefaults(info: ComponentInfo): Record<string, unknown> {
  return {
    ...defaultsOf(info.props),
    ...(info.children === "text" && { children: info.title }),
    ...(info.children === "slot" && { children: [] }),
    className: "",
  };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A value as source code, one key or item to a line where it doesn't fit on one. */
function print(value: unknown, indent: string): string {
  if (value instanceof Code) return value.text;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Lists of objects, such as a choice's options, read best one to a line.
    const inline = `[${value.map((item) => print(item, "")).join(", ")}]`;
    if (inline.length <= 80 && !value.some((item) => item && typeof item === "object")) return inline;
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${print(item, inner)},`).join("\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));
    const inline = `{ ${entries.map(([name, item]) => `${key(name)}: ${print(item, "")}`).join(", ")} }`;
    if (inline.length <= 80 && !inline.includes("\n")) return inline;
    const inner = `${indent}  `;
    return `{\n${entries.map(([name, item]) => `${inner}${key(name)}: ${print(item, inner)},`).join("\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A block's source, `blocks/installed/<name>/block.tsx`, that renders the component with its fields' values. */
export function componentBlockSource(info: ComponentInfo): string {
  const part = `gf-${info.name}`;
  const props = info.props.map((prop) => prop.name);
  const fields = {
    ...fieldsOf(info.props),
    ...(info.children === "text" && { children: { type: "text", label: "Label", contentEditable: true } }),
    ...(info.children === "slot" && { children: { type: "slot" } }),
    className: new Code("classNameField"),
  };
  const usesMedia = JSON.stringify(info.props).includes('"media":true');
  const reactImports = ["classNameField", ...(usesMedia ? ["mediaField"] : []), "useParts", "withParts"];
  const puckImports = ["ComponentConfig", ...(info.children === "slot" ? ["Slot"] : [])];
  const imported = info.isDefault ? info.component : `{ ${info.component} }`;

  const own = props.map((name) => JSON.stringify(name)).join(" | ");
  const type = [
    ...(own ? [`Pick<ComponentProps<typeof ${info.component}>, ${own}>`] : []),
    `{ ${[
      ...(info.children === "text" ? ["children: string"] : []),
      ...(info.children === "slot" ? ["children: Slot"] : []),
      "className: string",
    ].join("; ")} }`,
  ].join(" & ");

  const passed = props.map((name) => `${name}={${name}}`);
  const classes = info.section
    ? `part(${JSON.stringify(part)}, undefined, className)`
    : `part(${JSON.stringify(part)}, ${JSON.stringify(COMPONENT_SPACING)}, className)`;
  // A section takes the block's classes itself; a component goes in a wrapper that has them, with spacing around it.
  const attributes = [...passed, ...(info.section && info.className ? [`className={${classes}}`] : [])];
  const open = `${info.component}${attributes.length ? ` ${attributes.join(" ")}` : ""}`;
  const inner =
    info.children === "slot"
      ? [`<${open}>`, "  <Children />", `</${info.component}>`]
      : info.children === "text"
        ? [`<${open}>{children}</${info.component}>`]
        : [`<${open} />`];
  const element =
    info.section && info.className ? inner : [`<div className={${classes}}>`, ...inner.map((l) => `  ${l}`), "</div>"];
  const rendered = element.map((line) => `        ${line}`).join("\n");
  const destructured = [
    ...props,
    ...(info.children === "slot" ? ["children: Children"] : info.children ? ["children"] : []),
    "className",
  ];

  const notes = info.notes?.length ? ["//", "// Left to do by hand:", ...info.notes.map((note) => `// - ${note}`)] : [];
  return [
    `import { ${reactImports.join(", ")} } from "@goodfellow-cms/react";`,
    `import type { ${puckImports.join(", ")} } from "@puckeditor/core";`,
    ...(own ? ['import type { ComponentProps } from "react";'] : []),
    `import ${imported} from ${JSON.stringify(info.from)};`,
    "",
    `// Made from ${info.component}'s props by \`goodfellow blocks add\`. Change it as you like: the command doesn't`,
    "// write it again, and the Blocks screen removes it only while it's unchanged.",
    ...notes,
    "",
    `type Props = ${type};`,
    "",
    "const Block: ComponentConfig<Props> = withParts(",
    "  {",
    `    label: ${JSON.stringify(info.title)},`,
    `    fields: ${print(fields, "    ")},`,
    `    defaultProps: ${print(componentDefaults(info), "    ")},`,
    `    render: ({ ${destructured.join(", ")} }) => {`,
    "      const part = useParts();",
    "      return (",
    rendered,
    "      );",
    "    },",
    "  },",
    `  { ${JSON.stringify(part)}: ${JSON.stringify(info.title)} },`,
    ");",
    "",
    "export default Block;",
    "",
  ].join("\n");
}
