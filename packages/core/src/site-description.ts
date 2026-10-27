/**
 * What a site's build says about itself, for tools that edit its content
 * without its code, such as the Claude connector: its blocks and their fields,
 * the content versions it reads, and the Goodfellow release it was built with.
 * Builds write it to `SITE_DESCRIPTION_PATH`; `describeSite()` in
 * `@goodfellow-cms/react` makes it from the site's config.
 */
import type { Config } from "@puckeditor/core";
import { z } from "zod";
import { type BlockIcon, blockIconSchema } from "./block-icons.js";
import { type ContentKind, CURRENT_VERSION } from "./migrations/index.js";
import type { PluginDescription } from "./plugins.js";

declare const __GOODFELLOW_VERSION__: string | undefined;

/** The Goodfellow release this copy of core belongs to. */
export const GOODFELLOW_VERSION: string = typeof __GOODFELLOW_VERSION__ === "string" ? __GOODFELLOW_VERSION__ : "0.0.0";

/** Where builds put the description, from the site's root. */
export const SITE_DESCRIPTION_PATH = "goodfellow-site.json";

/** One block as tools see it: Puck's field definitions without their code. */
export interface BlockDescription {
  label?: string;
  /** Puck's fields, as JSON: functions such as a custom field's `render` are left out. */
  fields: Record<string, unknown>;
  defaultProps?: Record<string, unknown>;
  /** Only for collection templates, never pages, the header or the footer. */
  templateOnly?: boolean;
  /** The named parts it renders, such as `gf-card-title`, each with what owners call it, for themes' classes. */
  parts?: Record<string, string>;
  /** Other words the editor's block list finds it by, besides its label, name and group. */
  keywords?: string[];
  /** What the editor's block list, and editor plugins', show beside its name (`block-icons.ts`). */
  icon?: BlockIcon;
}

export interface SiteDescription {
  version: 1;
  /** The Goodfellow release the site was built with, such as `0.3.0`. */
  goodfellow: string;
  /** The version of each kind of content file the site reads. */
  content: Partial<Record<ContentKind, number>>;
  /** The page settings' fields, such as its title. */
  root: { fields: Record<string, unknown> };
  /** The site's blocks, by the name content refers to them by. */
  blocks: Record<string, BlockDescription>;
  /**
   * The config's admin address, where the sign-in worker gives tokens as well
   * as the Site address (`GoodfellowConfig.admin`).
   */
  admin?: { url: string; checked?: boolean };
  /** The config's token broker, where the sign-in worker gives tokens as well (`GoodfellowConfig.broker`). */
  broker?: { url: string };
  /** The config's other copies of the site, such as a staging site, where the sign-in worker gives tokens as well (`GoodfellowConfig.copies`). */
  copies?: string[];
  /** What the site's config lets Claude do (`GoodfellowConfig.claude`), when it's less than everything. */
  claude?: { publish?: boolean };
  /** The config's plugins, without their code (`describePlugin()`). */
  plugins?: PluginDescription[];
}

/**
 * Puck's config as far as a description tells, for code that needs blocks'
 * fields but not their code, such as finding links: the blocks for pages, the
 * header and footer (`layout`, without page settings), or collections' templates.
 * Blocks render nothing.
 */
export function describedConfig(description: SiteDescription, kind: "page" | "layout" | "template"): Config {
  return {
    components: Object.fromEntries(
      Object.entries(description.blocks)
        .filter(([, block]) => kind === "template" || !block.templateOnly)
        .map(([name, block]) => [
          name,
          {
            ...(block.label && { label: block.label }),
            fields: block.fields,
            ...(block.defaultProps && { defaultProps: block.defaultProps }),
            render: () => null,
          },
        ]),
    ),
    root: { fields: kind === "layout" ? {} : description.root.fields },
  } as unknown as Config;
}

const record = z.record(z.string(), z.unknown());

const descriptionSchema = z.object({
  version: z.literal(1),
  goodfellow: z.string().regex(/^\d+\.\d+\.\d+/),
  content: z.record(z.string(), z.number().int().positive()),
  root: z.object({ fields: record }),
  blocks: z.record(
    z.string(),
    z.object({
      label: z.string().optional(),
      fields: record,
      defaultProps: record.optional(),
      templateOnly: z.boolean().optional(),
      parts: z.record(z.string(), z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      icon: blockIconSchema,
    }),
  ),
  admin: z.object({ url: z.string(), checked: z.boolean().optional() }).optional(),
  broker: z.object({ url: z.string() }).optional(),
  copies: z.array(z.string()).optional(),
  claude: z.object({ publish: z.boolean().optional() }).optional(),
  plugins: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        version: z.string().optional(),
        description: z.string().optional(),
        permissions: z.object({
          connect: z.array(z.string()).optional(),
          files: z.array(z.string()).optional(),
          secrets: z.array(z.string()).optional(),
          read: z.array(z.string()).optional(),
          write: z.array(z.string()).optional(),
        }),
        id: z.string(),
        admin: z.boolean().optional(),
        screens: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
        build: z.array(z.object({ id: z.string(), title: z.string().optional() })).optional(),
        tasks: z.array(z.object({ id: z.string(), title: z.string().optional() })).optional(),
        server: z.boolean().optional(),
        mediaStorage: z.object({ maxBytes: z.number().optional() }).optional(),
        editor: z
          .object({ title: z.string(), kinds: z.array(z.enum(["page", "header", "footer", "template"])) })
          .optional(),
        options: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

/** Reads a description, or says why it isn't one. */
export function parseSiteDescription(text: string): { ok: true; description: SiteDescription } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const result = descriptionSchema.safeParse(raw);
  return result.success ? { ok: true, description: result.data as SiteDescription } : { ok: false };
}

/** Why a tool can't write a site's content. */
export type SiteVersionProblem =
  /** The site was built with a release older than the previous minor one: it should update. */
  | "site-too-old"
  /** The site was built with a newer release than the tool: the tool should update. */
  | "tool-too-old";

function minorOf(version: string): [number, number] {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return [major, minor];
}

/**
 * Whether a tool on release `tool` can write a site's content: the site must be
 * on the same minor release or the one before, and read the same version of
 * every kind of content file as the tool writes.
 */
export function siteVersionProblem(
  description: Pick<SiteDescription, "goodfellow" | "content">,
  tool: string = GOODFELLOW_VERSION,
  versions: Partial<Record<ContentKind, number>> = CURRENT_VERSION,
): SiteVersionProblem | undefined {
  const [siteMajor, siteMinor] = minorOf(description.goodfellow);
  const [toolMajor, toolMinor] = minorOf(tool);
  if (siteMajor > toolMajor || (siteMajor === toolMajor && siteMinor > toolMinor)) return "tool-too-old";
  const previous = siteMajor === toolMajor && (siteMinor === toolMinor || siteMinor === toolMinor - 1);
  if (!previous) return "site-too-old";
  for (const [kind, version] of Object.entries(versions)) {
    const read = description.content[kind as ContentKind];
    // A kind of file the site doesn't list came after it, such as the theme's
    // record: at its first version, nothing the site reads is written differently.
    if (read === undefined && version === 1) continue;
    if (read === undefined || read < version) return "site-too-old";
    if (read > version) return "tool-too-old";
  }
  return undefined;
}
