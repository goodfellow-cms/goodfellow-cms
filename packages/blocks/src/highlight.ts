import {
  type CodeStyle,
  codeStyle,
  type DarkCodeTheme,
  DEFAULT_CODE_THEMES,
  type LightCodeTheme,
} from "@goodfellow-cms/core";
import type { HighlighterCore, ShikiTransformer, ThemeRegistration } from "shiki/core";

/** The languages code can be highlighted as, by Shiki's name, with what the editor calls them. */
export const CODE_LANGUAGES = {
  text: "Plain text",
  bash: "Terminal (Bash)",
  css: "CSS",
  diff: "Changes (diff)",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  python: "Python",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
} as const;

export type CodeLanguage = keyof typeof CODE_LANGUAGES;

/** Other names code blocks in Markdown use for the same languages. */
const ALIASES: Record<string, CodeLanguage> = {
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  console: "bash",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  md: "markdown",
  yml: "yaml",
  py: "python",
  plaintext: "text",
  txt: "text",
};

/** Code's colors: like the page (light, or dark in the site's dark mode), or always light or dark. */
export type CodeColors = "page" | "light" | "dark";

type ThemeModule = Promise<{ default: ThemeRegistration }>;

/** Each theme `CODE_THEMES` offers, loaded only when a site's code uses it. */
export const CODE_THEME_LOADERS: Record<LightCodeTheme | DarkCodeTheme, () => ThemeModule> = {
  "github-light": () => import("shiki/themes/github-light.mjs"),
  "everforest-light": () => import("shiki/themes/everforest-light.mjs"),
  "vitesse-light": () => import("shiki/themes/vitesse-light.mjs"),
  "rose-pine-dawn": () => import("shiki/themes/rose-pine-dawn.mjs"),
  "catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
  "solarized-light": () => import("shiki/themes/solarized-light.mjs"),
  "one-light": () => import("shiki/themes/one-light.mjs"),
  "min-light": () => import("shiki/themes/min-light.mjs"),
  "gruvbox-light-soft": () => import("shiki/themes/gruvbox-light-soft.mjs"),
  "kanagawa-lotus": () => import("shiki/themes/kanagawa-lotus.mjs"),
  "ayu-light": () => import("shiki/themes/ayu-light.mjs"),
  "material-theme-lighter": () => import("shiki/themes/material-theme-lighter.mjs"),
  "night-owl-light": () => import("shiki/themes/night-owl-light.mjs"),
  "light-plus": () => import("shiki/themes/light-plus.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
  "github-dark-dimmed": () => import("shiki/themes/github-dark-dimmed.mjs"),
  "everforest-dark": () => import("shiki/themes/everforest-dark.mjs"),
  "vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
  "kanagawa-dragon": () => import("shiki/themes/kanagawa-dragon.mjs"),
  "kanagawa-wave": () => import("shiki/themes/kanagawa-wave.mjs"),
  "rose-pine": () => import("shiki/themes/rose-pine.mjs"),
  "rose-pine-moon": () => import("shiki/themes/rose-pine-moon.mjs"),
  "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
  "catppuccin-macchiato": () => import("shiki/themes/catppuccin-macchiato.mjs"),
  nord: () => import("shiki/themes/nord.mjs"),
  "one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
  "tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
  "gruvbox-dark-medium": () => import("shiki/themes/gruvbox-dark-medium.mjs"),
  "solarized-dark": () => import("shiki/themes/solarized-dark.mjs"),
  "night-owl": () => import("shiki/themes/night-owl.mjs"),
  "min-dark": () => import("shiki/themes/min-dark.mjs"),
  dracula: () => import("shiki/themes/dracula.mjs"),
  "material-theme-darker": () => import("shiki/themes/material-theme-darker.mjs"),
  poimandres: () => import("shiki/themes/poimandres.mjs"),
  "ayu-dark": () => import("shiki/themes/ayu-dark.mjs"),
  vesper: () => import("shiki/themes/vesper.mjs"),
  "dark-plus": () => import("shiki/themes/dark-plus.mjs"),
  monokai: () => import("shiki/themes/monokai.mjs"),
};

/** The language a name means, such as `ts` → `typescript`, or `undefined` if it isn't one Goodfellow highlights. */
export function codeLanguage(name: string): CodeLanguage | undefined {
  const key = name.toLowerCase();
  if (key in CODE_LANGUAGES) return key as CodeLanguage;
  return ALIASES[key];
}

let highlighter: Promise<HighlighterCore> | undefined;

function loadCore(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [CODE_THEME_LOADERS[DEFAULT_CODE_THEMES.light](), CODE_THEME_LOADERS[DEFAULT_CODE_THEMES.dark]()],
      langs: [
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/jsx.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/yaml.mjs"),
      ],
    });
  })();
  highlighter.catch(() => {
    highlighter = undefined;
  });
  return highlighter;
}

/**
 * Loads the highlighter the first time code needs it, with the themes a site's
 * code uses. Shiki, its grammars and themes are only loaded by builds and the
 * editor, never by visitors, who get highlighted HTML.
 */
export async function loadHighlighter(style: CodeStyle = codeStyle(undefined)): Promise<HighlighterCore> {
  const shiki = await loadCore();
  const loaded = new Set(shiki.getLoadedThemes());
  const missing = [style.light, style.dark].filter((name) => !loaded.has(name));
  if (missing.length > 0) await shiki.loadTheme(...missing.map((name) => CODE_THEME_LOADERS[name]()));
  return shiki;
}

/** Gives code the site's panel color in place of its themes' backgrounds. */
const siteBackground: ShikiTransformer = {
  pre(node) {
    const style = String(node.properties.style ?? "")
      .split(";")
      .filter((declaration) => !/^\s*(background-color|--shiki-dark-bg)\s*:/.test(declaration))
      .join(";");
    node.properties.style = `${style};background-color:var(--muted);--shiki-dark-bg:var(--muted)`;
  },
};

/**
 * Highlighted HTML for some code: a `<pre>` whose colors are inline styles,
 * in the site's code themes (`codeStyle()`). Shiki escapes the code, so the
 * HTML is safe to put in a page.
 */
export function highlightCode(
  shiki: HighlighterCore,
  code: string,
  language: string,
  colors: CodeColors = "page",
  style: CodeStyle = codeStyle(undefined),
): string {
  const lang = codeLanguage(language) ?? "text";
  if (colors !== "page") return shiki.codeToHtml(code, { lang, theme: style[colors] });
  const transformers = style.siteBackground ? [siteBackground] : [];
  // Light-only sites only need the light colors.
  if (!style.darkMode) return shiki.codeToHtml(code, { lang, theme: style.light, transformers });
  // Both themes' colors, as CSS variables for the dark one, which styles.css uses in dark mode.
  return shiki.codeToHtml(code, {
    lang,
    themes: { light: style.light, dark: style.dark },
    defaultColor: "light",
    transformers,
  });
}
