import { COLOR_SCHEME_ATTRIBUTE } from "./color-scheme.js";
import { THEME_COLORS, type Theme, type ThemeColor } from "./content/schemas.js";

/** The theme used for anything a site doesn't set. Neutral grays, so any brand color works on top. */
export const DEFAULT_THEME_COLORS: Record<ThemeColor, string> = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f5f5f5",
  secondaryForeground: "#171717",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  accent: "#f5f5f5",
  accentForeground: "#171717",
  border: "#e5e5e5",
};

/** The dark mode colors used for anything a site doesn't set: shadcn/ui's neutral dark theme. */
export const DEFAULT_DARK_THEME_COLORS: Record<ThemeColor, string> = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  primary: "#fafafa",
  primaryForeground: "#171717",
  secondary: "#262626",
  secondaryForeground: "#fafafa",
  muted: "#262626",
  mutedForeground: "#a3a3a3",
  accent: "#262626",
  accentForeground: "#fafafa",
  border: "#262626",
};

/**
 * The code themes Site Settings offers, by Shiki's name, with what the admin
 * panel calls them. `@goodfellow-cms/blocks` loads each one when a site uses it.
 */
export const CODE_THEMES = {
  light: {
    "github-light": "GitHub Light",
    "everforest-light": "Everforest Light",
    "vitesse-light": "Vitesse Light",
    "rose-pine-dawn": "Rosé Pine Dawn",
    "catppuccin-latte": "Catppuccin Latte",
    "solarized-light": "Solarized Light",
    "one-light": "One Light",
    "min-light": "Min Light",
    "gruvbox-light-soft": "Gruvbox Light",
    "kanagawa-lotus": "Kanagawa Lotus",
    "ayu-light": "Ayu Light",
    "material-theme-lighter": "Material Lighter",
    "night-owl-light": "Night Owl Light",
    "light-plus": "Visual Studio Code Light",
  },
  dark: {
    "github-dark": "GitHub Dark",
    "github-dark-dimmed": "GitHub Dark Dimmed",
    "everforest-dark": "Everforest Dark",
    "vitesse-dark": "Vitesse Dark",
    "kanagawa-dragon": "Kanagawa Dragon",
    "kanagawa-wave": "Kanagawa Wave",
    "rose-pine": "Rosé Pine",
    "rose-pine-moon": "Rosé Pine Moon",
    "catppuccin-mocha": "Catppuccin Mocha",
    "catppuccin-macchiato": "Catppuccin Macchiato",
    nord: "Nord",
    "one-dark-pro": "One Dark Pro",
    "tokyo-night": "Tokyo Night",
    "gruvbox-dark-medium": "Gruvbox Dark",
    "solarized-dark": "Solarized Dark",
    "night-owl": "Night Owl",
    "min-dark": "Min Dark",
    dracula: "Dracula",
    "material-theme-darker": "Material Darker",
    poimandres: "Poimandres",
    "ayu-dark": "Ayu Dark",
    vesper: "Vesper",
    "dark-plus": "Visual Studio Code Dark",
    monokai: "Monokai",
  },
} as const;

export type LightCodeTheme = keyof (typeof CODE_THEMES)["light"];
export type DarkCodeTheme = keyof (typeof CODE_THEMES)["dark"];

export const DEFAULT_CODE_THEMES = { light: "github-light", dark: "github-dark" } as const;

/** How a site's code is colored, from its theme, with defaults for anything it doesn't set or Goodfellow doesn't offer. */
export interface CodeStyle {
  light: LightCodeTheme;
  dark: DarkCodeTheme;
  /** Code colored like the page takes the site's panel color (`--muted`) rather than its theme's background. */
  siteBackground: boolean;
  /** Whether the site has dark mode, so code colored like the page needs its dark colors too. */
  darkMode: boolean;
}

export function codeStyle(theme: Partial<Theme> | undefined): CodeStyle {
  const code = theme?.code;
  const light = code?.light && code.light in CODE_THEMES.light ? (code.light as LightCodeTheme) : undefined;
  const dark = code?.dark && code.dark in CODE_THEMES.dark ? (code.dark as DarkCodeTheme) : undefined;
  return {
    light: light ?? DEFAULT_CODE_THEMES.light,
    dark: dark ?? DEFAULT_CODE_THEMES.dark,
    siteBackground: code?.background === "site",
    darkMode: theme?.darkMode === true,
  };
}

export const DEFAULT_RADIUS = "0.5rem";

const FALLBACK_FONTS = "ui-sans-serif, system-ui, sans-serif";

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Makes text safe to place inside a `<style>` element: nothing in it can close
 * the element or open an HTML comment.
 */
export function escapeStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1").replace(/<!--/g, "\\3c !--");
}

/**
 * The CSS custom properties for a theme, as a `:root` rule. Colors use
 * shadcn's variable names (`--primary`, `--primary-foreground`, …); fonts use
 * `--gf-font-heading` and `--gf-font-body`.
 */
export function themeToCss(theme: Theme): string {
  const declarations = THEME_COLORS.map(
    (name) => `--${kebab(name)}:${theme.colors[name] ?? DEFAULT_THEME_COLORS[name]}`,
  );
  const darkRules = theme.darkMode ? darkModeCss(theme) : "";
  declarations.push(`--radius:${theme.radius ?? DEFAULT_RADIUS}`);
  const { heading, body } = theme.fonts;
  declarations.push(`--gf-font-body:${body ? `"${body}", ${FALLBACK_FONTS}` : FALLBACK_FONTS}`);
  declarations.push(`--gf-font-heading:${heading ? `"${heading}", ${FALLBACK_FONTS}` : "var(--gf-font-body)"}`);
  return escapeStyleText(`:root{${declarations.join(";")}}${darkRules}`);
}

/** A color in dark mode: the site's own, or the default. */
export function darkThemeColor(theme: Theme, name: ThemeColor): string {
  return theme.darkColors?.[name] ?? DEFAULT_DARK_THEME_COLORS[name];
}

/**
 * Dark mode's colors: when the visitor's computer is set to dark, unless a
 * preview shows the site light, and whenever a preview shows it dark.
 */
function darkModeCss(theme: Theme): string {
  const colors = THEME_COLORS.map((name) => `--${kebab(name)}:${darkThemeColor(theme, name)}`).join(";");
  const attribute = (value: string) => `[${COLOR_SCHEME_ATTRIBUTE}="${value}"]`;
  return [
    `:root{color-scheme:light dark}`,
    `@media (prefers-color-scheme: dark){:root:not(${attribute("light")}){${colors}}}`,
    `:root${attribute("light")}{color-scheme:light}`,
    `:root${attribute("dark")}{${colors};color-scheme:dark}`,
  ].join("");
}

/**
 * The `<meta name="color-scheme">` a page has, which tells the browser the
 * page has a dark mode and lets blocks' `dark:` classes apply (see
 * `@goodfellow-cms/react/theme.css`). Light-only sites have none.
 */
export function colorSchemeMeta(theme: Theme): string | undefined {
  return theme.darkMode ? "light dark" : undefined;
}

/**
 * The Google Fonts stylesheet for a theme's fonts, or `undefined` if it uses none.
 * `display=fallback` waits up to 100 ms for a font before showing a stand-in, so
 * fonts the browser already has, such as on the site's next page, show at once
 * instead of the stand-in first. (`swap` shows the stand-in even then.) A font that
 * takes longer replaces the stand-in if it arrives within 3 seconds.
 */
export function googleFontsUrl(theme: Theme): string | undefined {
  const families = [...new Set([theme.fonts.heading, theme.fonts.body].filter(Boolean))] as string[];
  if (families.length === 0) return undefined;
  const params = families.map((family) => `family=${family.trim().replace(/ +/g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=fallback`;
}
