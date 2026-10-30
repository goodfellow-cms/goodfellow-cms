/**
 * Themes: a site's look as data, with no code, published on npm as
 * `goodfellow-theme-<name>`. Installing one copies its settings into
 * `content/site.json`'s `theme`, its CSS into the start of the site's custom
 * CSS, and optionally its header and footer, where owners change them like
 * any setting, and keeps a record of what it installed (`THEME_FILE`), so an
 * update replaces only what nobody has changed since.
 */
import { z } from "zod";
import { CURRENT_VERSION } from "../migrations/index.js";
import { earlyInstallSchema, type ProvenanceSource, provenanceSourceSchema } from "../provenance.js";
import { hashText } from "../registry.js";
import { customCssFileChange, layoutFileChange, siteSettingsFileChange, storedCss } from "./changes.js";
import { ContentError } from "./errors.js";
import { parseContentFile } from "./load.js";
import { FOOTER_FILE, HEADER_FILE, THEME_FILE } from "./paths.js";
import { type LayoutFile, layoutFileSchema, type SiteSettings, type Theme, themeSchema } from "./schemas.js";
import { serializeContent } from "./serialize.js";
import type { FileChange } from "./store.js";

/** A file in a theme's package, such as `theme.css`: a path within it, never above it. */
const packagePath = z
  .string()
  .regex(/^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]*$/, "must be a file in the theme's package, such as theme.css");

/** `goodfellow-theme.json`, at the root of a theme's package: what it is, and which of its files to install. */
export const themeManifestSchema = z.object({
  version: z.literal(1),
  /** What owners call it, such as "Forest". */
  title: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  /** Its colors, fonts and other settings, as `content/site.json`'s `theme` has them. */
  theme: themeSchema.default({ colors: {}, fonts: {} }),
  /** Its CSS, which goes at the start of the site's custom CSS. */
  css: packagePath.optional(),
  /** A header and footer design, as `content/layout/header.json` and `footer.json` have them, using only built-in blocks. */
  header: packagePath.optional(),
  footer: packagePath.optional(),
  /** A picture of a site with it, shown before it's installed. */
  image: packagePath.optional(),
});
export type ThemeManifest = z.output<typeof themeManifestSchema>;

/** A theme's release, read from its package: everything installing it may write. */
export interface ThemePackage {
  /** Its npm package, such as `goodfellow-theme-forest`. */
  name: string;
  /** The release, such as `1.2.0`. */
  release: string;
  manifest: ThemeManifest;
  css?: string;
  header?: LayoutFile;
  footer?: LayoutFile;
  /** The Goodfellow releases it says it works with: its `peerDependencies` range on `@goodfellow-cms/core`. */
  goodfellow?: string;
}

/** A hex SHA-256 of what was installed. */
const hash = z.string().regex(/^[0-9a-f]{64}$/);

/** `content/styles/theme.json`: the theme the site's look came from, and what it installed. */
export const themeRecordSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  release: z.string(),
  title: z.string(),
  goodfellow: z.string().optional(),
  /** The theme's settings as its release gave them. */
  theme: themeSchema.default({ colors: {}, fonts: {} }),
  /** Hashes of the CSS, header and footer it wrote, where it wrote them. */
  css: hash.optional(),
  header: hash.optional(),
  footer: hash.optional(),
  /** Where its release was built, from its provenance, which updates installed early must match. */
  provenance: provenanceSourceSchema.optional(),
  /** Installed before it was old enough, as an update with the same provenance, which the site's build checks. */
  early: earlyInstallSchema.optional(),
});
export type ThemeRecord = z.output<typeof themeRecordSchema>;

/** The site's theme record from its text, or `undefined` when it has none. Throws a `ContentError` if it can't be used. */
export function parseThemeRecord(text: string | undefined): ThemeRecord | undefined {
  if (text === undefined) return undefined;
  const result = parseContentFile("theme", themeRecordSchema, THEME_FILE, text);
  if (!result.ok) throw new ContentError([result.problem]);
  return result.value;
}

/** One theme setting's value, by where it is: `colors.primary`, `fonts.heading`, `radius`, `parts.gf-card`. */
export type ThemeValues = Record<string, string | boolean>;

const GROUPS = ["colors", "darkColors", "fonts", "code", "parts"] as const;

/** Every setting a theme gives, one by one, so each can be kept or replaced on its own. */
export function themeValues(theme: Partial<Theme>): ThemeValues {
  const values: ThemeValues = {};
  for (const group of GROUPS) {
    for (const [name, value] of Object.entries(theme[group] ?? {})) {
      if (typeof value === "string" || typeof value === "boolean") values[`${group}.${name}`] = value;
    }
  }
  if (theme.darkMode !== undefined) values.darkMode = theme.darkMode;
  if (theme.radius !== undefined) values.radius = theme.radius;
  return values;
}

/** The theme settings these values make. */
export function themeFromValues(values: ThemeValues): Theme {
  const theme: Record<string, unknown> = { colors: {}, fonts: {} };
  for (const [key, value] of Object.entries(values)) {
    const dot = key.indexOf(".");
    if (dot === -1) {
      theme[key] = value;
      continue;
    }
    const group = key.slice(0, dot);
    const record = (theme[group] ?? {}) as Record<string, unknown>;
    record[key.slice(dot + 1)] = value;
    theme[group] = record;
  }
  return themeSchema.parse(theme);
}

/** The line a theme's CSS starts with in the site's custom CSS, followed by its name and release. */
const CSS_START = "/* Theme CSS:";
/** The line it ends with. */
export const THEME_CSS_END = "/* End of theme CSS */";
const CSS_REGION = /^\/\* Theme CSS: (\S+)[^\n]*\*\/\n([\s\S]*?)\n?\/\* End of theme CSS \*\/\n*/m;

/** Where a theme's CSS is in the site's custom CSS, if it's there. */
export function themeCssRegion(css: string): { name: string; css: string } | undefined {
  const match = CSS_REGION.exec(css);
  return match ? { name: match[1] ?? "", css: match[2] ?? "" } : undefined;
}

/** The site's custom CSS with the theme's CSS replaced, added at the start, or removed (`undefined`). */
export function withThemeCss(css: string, theme: { name: string; release: string; css: string } | undefined): string {
  const rest = css.replace(CSS_REGION, "").replace(/^\n+/, "");
  if (!theme?.css.trim()) return rest;
  const region = `${CSS_START} ${theme.name} ${theme.release}. An update replaces it unless it's changed. */\n${theme.css.trim()}\n${THEME_CSS_END}\n`;
  return rest.trim() ? `${region}\n${rest}` : region;
}

/** Addresses a theme's CSS may load without being listed: Google Fonts, and the site's own media. */
function allowedLoad(address: string): boolean {
  if (/^data:/i.test(address)) return true;
  if (/^\/media\/[^/]/.test(address)) return true;
  return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(address);
}

/**
 * What a theme's CSS loads besides Google Fonts and the site's own media,
 * such as pictures or fonts from other sites, which visitors' browsers would
 * then ask those sites for. The admin panel lists them before installing it.
 */
export function themeCssLoads(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set<string>();
  const unescaped = (value: string) => value.replace(/\\(.)/g, "$1").trim();
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)) {
    found.add(unescaped(match[1] ?? match[2] ?? match[3] ?? ""));
  }
  for (const match of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    found.add(unescaped(match[1] ?? match[2] ?? ""));
  }
  return [...found].filter((address) => address !== "" && !allowedLoad(address)).sort();
}

/** The parts of a site installing a theme changes. */
export interface ThemeSite {
  settings: SiteSettings;
  customCss: string;
  header: LayoutFile;
  footer: LayoutFile;
  /** What the theme installed before, if one is installed. */
  record?: ThemeRecord;
}

/** Something owners changed that a theme's release changed too: kept on an update, replaced by another theme. */
export type ThemeChanged = { kind: "setting"; key: string } | { kind: "css" | "header" | "footer" };

export interface ThemeOptions {
  /** Whether to use the theme's header and footer. On an update, they're used where the release before was. */
  layout?: boolean;
  /** Where the release was built, from its provenance, for the record, which early updates are checked against. */
  provenance?: ProvenanceSource;
  /**
   * Installs it before it's old enough, as an update built by the same source as the release installed
   * (`mayInstallEarly()`'s `source`), which the site's build checks. Only an update of the installed theme can be.
   */
  early?: ProvenanceSource;
}

export interface ThemePlan {
  changes: FileChange[];
  /** The site's settings, custom CSS, header and footer as the changes leave them, for previews. */
  settings: SiteSettings;
  customCss: string;
  header: LayoutFile;
  footer: LayoutFile;
  /** On an update: owners' changes kept, where the new release changed the same thing. */
  kept: ThemeChanged[];
  /** Installing another theme, or removing it: owners' changes to the theme before that it replaces. */
  replaced: ThemeChanged[];
}

function layoutText(file: string, layout: LayoutFile): string {
  const change = layoutFileChange(file, layout.data);
  return "content" in change ? change.content : "";
}

/**
 * The changes that install a theme's release, update the installed theme to
 * it, or, with no theme, remove the installed one. An update (the same theme)
 * replaces only settings, CSS, header and footer nobody has changed since the
 * release before, and lists the rest as `kept`. Another theme replaces every
 * setting it gives and the theme before's CSS, and removes the theme before's
 * other settings nobody changed, so they fall back to the defaults; removing
 * the theme does the same, leaving its header and footer.
 */
export async function planTheme(
  site: ThemeSite,
  theme: ThemePackage | undefined,
  options: ThemeOptions = {},
): Promise<ThemePlan> {
  const old = site.record;
  const update = old !== undefined && theme !== undefined && old.name === theme.name;
  const kept: ThemeChanged[] = [];
  const replaced: ThemeChanged[] = [];

  // Settings, one by one.
  const before = themeValues(old?.theme ?? {});
  const after = themeValues(theme?.manifest.theme ?? {});
  const current = themeValues(site.settings.theme);
  const values = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const now = current[key];
    const was = before[key];
    const next = after[key];
    const changed = key in before && now !== was;
    if (update && changed) {
      if (next !== was) kept.push({ kind: "setting", key });
      continue;
    }
    if (next === undefined) {
      if (!changed) delete values[key];
      continue;
    }
    if (changed && now !== next) replaced.push({ kind: "setting", key });
    values[key] = next;
  }
  const settings = { ...site.settings, theme: themeFromValues(values) };

  // The CSS, at the start of the custom CSS.
  const region = themeCssRegion(site.customCss);
  const regionChanged = region !== undefined && (!old?.css || (await hashText(region.css.trim())) !== old.css);
  const nextCss = theme?.css?.trim() ?? "";
  const nextHash = nextCss ? await hashText(nextCss) : undefined;
  let customCss = site.customCss;
  if (update && (regionChanged || (!region && old?.css))) {
    // Changed, or removed, since: left as it is.
    if (nextHash !== old?.css) kept.push({ kind: "css" });
  } else {
    if (regionChanged && old && region.name === old.name) replaced.push({ kind: "css" });
    customCss = withThemeCss(site.customCss, theme && { name: theme.name, release: theme.release, css: nextCss });
  }

  // The header and footer, where the theme has them and they're used.
  const layouts: Record<"header" | "footer", LayoutFile> = { header: site.header, footer: site.footer };
  const hashes: Partial<Record<"header" | "footer", string>> = {};
  const layoutChanges: FileChange[] = [];
  for (const part of ["header", "footer"] as const) {
    const file = part === "header" ? HEADER_FILE : FOOTER_FILE;
    const next = theme?.[part];
    if (!next) continue;
    const nextHash = await hashText(layoutText(file, next));
    const used = update ? (options.layout ?? old?.[part] !== undefined) : options.layout === true;
    if (!used) continue;
    const installed = update ? old?.[part] : undefined;
    if (installed && (await hashText(layoutText(file, site[part]))) !== installed) {
      if (nextHash !== installed) kept.push({ kind: part });
      hashes[part] = installed;
      continue;
    }
    layouts[part] = next;
    hashes[part] = nextHash;
    if (layoutText(file, next) !== layoutText(file, site[part])) layoutChanges.push(layoutFileChange(file, next.data));
  }

  const changes: FileChange[] = [];
  if (serializeContent(settings) !== serializeContent(site.settings)) changes.push(siteSettingsFileChange(settings));
  if (storedCss(customCss) !== storedCss(site.customCss)) changes.push(customCssFileChange(customCss));
  changes.push(...layoutChanges);
  if (theme) {
    const record = {
      version: CURRENT_VERSION.theme,
      name: theme.name,
      release: theme.release,
      title: theme.manifest.title,
      ...(theme.goodfellow && { goodfellow: theme.goodfellow }),
      theme: theme.manifest.theme,
      ...(nextHash && { css: nextHash }),
      ...hashes,
      ...(options.provenance && { provenance: options.provenance }),
      ...(options.early && update && { early: { from: old.release, ...options.early } }),
    };
    changes.push({ path: THEME_FILE, content: serializeContent(record) });
  } else if (old) {
    changes.push({ path: THEME_FILE, delete: true });
  }
  return { changes, settings, customCss, header: layouts.header, footer: layouts.footer, kept, replaced };
}

/** A header or footer from a theme's package, checked as loading the site checks its own. */
export function parseThemeLayout(file: string, text: string): LayoutFile {
  const result = parseContentFile("layout", layoutFileSchema, file, text);
  if (!result.ok) throw new ContentError([result.problem]);
  return result.value;
}
