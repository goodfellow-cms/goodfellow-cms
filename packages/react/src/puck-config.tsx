import {
  type AdminSite,
  type BlockIcon,
  CURRENT_VERSION,
  cleanBlockIcon,
  describePlugin,
  GOODFELLOW_VERSION,
  type GoodfellowConfig,
  type SiteDescription,
} from "@goodfellow-cms/core";
import type { ComponentConfig, Config, CustomField, Fields, TextField } from "@puckeditor/core";
import type { ReactNode } from "react";

/** The field every block gets for adding CSS classes, such as Tailwind utilities. */
export const classNameField: TextField = {
  type: "text",
  label: "CSS classes",
};

/** What kind of media a field holds, for the admin panel to offer its media library. */
export type MediaFieldKind = "image" | "video" | "audio" | "file";

/**
 * A text field for the address of an uploaded file, such as an image. The
 * admin panel shows a button to choose one from the site's media library.
 */
export function mediaField(label: string, kind: MediaFieldKind = "image"): TextField {
  return { type: "text", label, metadata: { media: kind } };
}

/** The kind of media a field holds, if it's a media field. */
export function mediaFieldKind(field: { metadata?: unknown } | undefined): MediaFieldKind | undefined {
  const media = (field?.metadata as { media?: unknown } | undefined)?.media;
  return media === "image" || media === "video" || media === "audio" || media === "file" ? media : undefined;
}

/** A table's cells, row by row, as plain text. */
export type TableCells = string[][];

/**
 * A field for a table's cells, row by row. The admin panel's editor shows it
 * as a grid of cells to type in; elsewhere it shows nothing, since fields are
 * only edited there. The AI assistant fills it in as rows of text.
 */
export function tableField(label: string): CustomField<TableCells> {
  return {
    type: "custom",
    label,
    metadata: {
      table: true,
      ai: { type: "table", description: "Rows of the table, each a list of its cells' plain text" },
    },
    render: () => <></>,
  };
}

/** Whether a field holds a table's cells (`tableField()`). */
export function isTableField(field: { metadata?: unknown } | undefined): boolean {
  return (field?.metadata as { table?: unknown } | undefined)?.table === true;
}

/** Cells as they're kept: rows of text, every row as long as the longest, never empty. */
export function tableCells(value: unknown): TableCells {
  const rows = Array.isArray(value)
    ? value.map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === "string" ? cell : "")) : []))
    : [];
  const width = Math.max(1, ...rows.map((row) => row.length));
  const filled = rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
  return filled.length > 0 ? filled : [Array<string>(width).fill("")];
}

/** Settings on the page itself (the root of the page's Puck data). */
const pageRootFields: Fields = {
  title: { type: "text", label: "Page title" },
  description: { type: "textarea", label: "Description for search engines" },
  image: mediaField("Image when shared"),
  noIndex: {
    type: "radio",
    label: "Search engines",
    options: [
      { label: "Show in search results", value: false },
      { label: "Hide from search results", value: true },
    ],
  },
  className: classNameField,
};

// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
type AnyComponentConfig = ComponentConfig<any>;

/**
 * Gives a block a "CSS classes" field. Blocks that declare their own
 * `className` field apply it themselves; any other block is wrapped in a
 * `<div>` carrying the classes, but only when some are set.
 */
export function withClassName(component: AnyComponentConfig): AnyComponentConfig {
  if (component.fields && "className" in component.fields) return component;

  const Inner = component.render;
  const { resolveFields } = component;

  return {
    ...component,
    fields: { ...component.fields, className: classNameField },
    ...(resolveFields && {
      resolveFields: async (data, params) => ({ ...(await resolveFields(data, params)), className: classNameField }),
    }),
    render: (props) => {
      const className = typeof props.className === "string" ? props.className.trim() : "";
      return className ? (
        <div className={className}>
          <Inner {...props} />
        </div>
      ) : (
        <Inner {...props} />
      );
    },
  };
}

const TEMPLATE_ONLY = Symbol.for("goodfellow.templateOnly");

/**
 * Marks a block as only for collection templates, such as one that shows a
 * field of the entry being displayed. It's left out of the editor for pages,
 * the header and the footer.
 */
export function templateOnly<T extends AnyComponentConfig>(component: T): T {
  return Object.assign(component, { [TEMPLATE_ONLY]: true });
}

export function isTemplateOnly(component: AnyComponentConfig): boolean {
  return TEMPLATE_ONLY in component;
}

const PARTS = Symbol.for("goodfellow.parts");

/** A block's named parts (`gf-card-title`), each with what owners call it ("Card's title"). */
export type BlockParts = Readonly<Record<string, string>>;

/**
 * Says which named parts a block renders (see `useParts()`), so the admin
 * panel can offer them to themes and owners. Part names are part of a site's
 * look, like props are of its content: never rename or remove one.
 */
export function withParts<T extends object>(component: T, parts: BlockParts): T {
  return Object.assign(component, { [PARTS]: parts });
}

/** The named parts a block renders, from `withParts()`. */
export function blockParts(component: object): BlockParts | undefined {
  return (component as { [PARTS]?: BlockParts })[PARTS];
}

const KEYWORDS = Symbol.for("goodfellow.keywords");

/**
 * Other words people might search the block list with, such as "divider" for
 * a Separator or WordPress's "Cover" for a Section: the block's label, name
 * and group are searched anyway.
 */
export function withKeywords<T extends object>(component: T, keywords: readonly string[]): T {
  return Object.assign(component, { [KEYWORDS]: [...keywords] });
}

/** The words a block's searched by besides its label, from `withKeywords()`. */
export function blockKeywords(component: object): readonly string[] | undefined {
  return (component as { [KEYWORDS]?: readonly string[] })[KEYWORDS];
}

const ICON = Symbol.for("goodfellow.icon");

/**
 * The block's icon in the block list, here and in editor plugins: SVG shapes
 * on a 24-unit grid with a 2-unit stroke, as Lucide's icon data is (`import {
 * Heading } from "lucide"`). Only plain shapes are kept (`cleanBlockIcon()`).
 */
export function withIcon<T extends object>(component: T, icon: unknown): T {
  const clean = cleanBlockIcon(icon);
  return clean ? Object.assign(component, { [ICON]: clean }) : component;
}

/** The block's icon, from `withIcon()`. */
export function blockIcon(component: object): BlockIcon | undefined {
  return (component as { [ICON]?: BlockIcon })[ICON];
}

/** Pages; the header and footer; or a collection's template, which is a page that can also show the entry's fields. */
export type PuckConfigKind = "page" | "layout" | "template";

/**
 * The built-in blocks' groups that start open in each editor, by their key in
 * `categories` from `@goodfellow-cms/blocks`: the rest of those start closed.
 * Groups of a site's own, and installed blocks', start open, as do any whose
 * `defaultExpanded` the site's config sets.
 */
export const OPEN_CATEGORIES: Readonly<Record<PuckConfigKind, readonly string[]>> = {
  page: ["layout", "content", "forms", "media"],
  layout: ["layout", "navigation"],
  template: ["layout", "content", "collections"],
};

/** The built-in blocks' groups, which `OPEN_CATEGORIES` opens and closes. */
const BUILT_IN_CATEGORIES = new Set(["layout", "content", "forms", "media", "navigation", "collections"]);

/**
 * Turns a site's Goodfellow config into the Puck config for pages, for the
 * header and footer, or for collection templates. They share the site's
 * blocks; pages and templates also have page settings.
 */
export function createPuckConfig(config: GoodfellowConfig, kind: PuckConfigKind): Config {
  const included = Object.entries(config.blocks).filter(
    ([, component]) => kind === "template" || !isTemplateOnly(component),
  );
  const names = new Set(included.map(([name]) => name));
  const components = Object.fromEntries(included.map(([name, component]) => [name, withClassName(component)]));
  const categories =
    config.categories &&
    Object.fromEntries(
      Object.entries(config.categories).map(([key, category]) => [
        key,
        {
          ...category,
          components: category.components?.filter((name) => names.has(String(name))),
          ...(category.defaultExpanded === undefined &&
            BUILT_IN_CATEGORIES.has(key) && { defaultExpanded: OPEN_CATEGORIES[kind].includes(key) }),
        },
      ]),
    );

  return {
    components,
    ...(categories && { categories }),
    root: {
      fields: kind === "layout" ? {} : pageRootFields,
      render: ({ children }: { children?: ReactNode }) => <>{children}</>,
    },
  } as Config;
}

/** A copy of Puck's field definitions as JSON: what they say, without the code in them. */
function asJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

/**
 * What the site's build says about its blocks, for tools that edit its
 * content without its code, such as the Claude connector. Builds write it to
 * `SITE_DESCRIPTION_PATH`.
 */
export function describeSite(config: GoodfellowConfig): SiteDescription {
  const puck = createPuckConfig(config, "template");
  return {
    version: 1,
    goodfellow: GOODFELLOW_VERSION,
    content: { ...CURRENT_VERSION },
    root: { fields: asJson(puck.root?.fields) },
    blocks: Object.fromEntries(
      Object.entries(puck.components).map(([name, component]) => {
        const block = config.blocks[name];
        return [
          name,
          {
            ...(component.label && { label: component.label }),
            fields: asJson(component.fields),
            ...(component.defaultProps && { defaultProps: asJson(component.defaultProps) }),
            ...(block && isTemplateOnly(block) && { templateOnly: true }),
            ...(block && blockParts(block) && { parts: { ...blockParts(block) } }),
            ...(block && blockKeywords(block) && { keywords: [...(blockKeywords(block) ?? [])] }),
            ...(block && blockIcon(block) && { icon: blockIcon(block) }),
          },
        ];
      }),
    ),
    ...(config.admin && {
      admin: { url: config.admin.url, ...(config.admin.checked === true && { checked: true }) },
    }),
    ...(config.broker && { broker: { url: config.broker.url } }),
    ...(config.copies?.length && { copies: [...config.copies] }),
    ...(config.claude?.publish === false && { claude: { publish: false } }),
    ...(config.plugins?.length && { plugins: config.plugins.map(describePlugin) }),
  };
}

/**
 * What the admin panel's own page needs to know about the site, which never
 * loads its config: its blocks' fields, and how to make its git host again.
 * Made wherever the config is loaded anyway, such as `goodfellow build` or a
 * Next.js server component.
 */
export function adminSite(config: GoodfellowConfig): AdminSite {
  return {
    description: describeSite(config),
    ...(config.backend?.source && { backend: config.backend.source }),
    ...(config.admin && { admin: config.admin }),
    ...(config.broker && { broker: config.broker }),
    ...(config.demo && { demo: true }),
    ...(config.ai !== undefined && { ai: config.ai }),
    ...(config.registries && { registries: config.registries }),
  };
}
