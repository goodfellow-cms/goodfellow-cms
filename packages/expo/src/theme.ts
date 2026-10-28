import {
  DEFAULT_RADIUS,
  DEFAULT_THEME_COLORS,
  darkThemeColor,
  type SiteSettings,
  THEME_COLORS,
  type ThemeColor,
} from "@goodfellow-cms/core";

/** The site's theme as native blocks style themselves with it: its colors in light or dark, corners and fonts. */
export interface NativeTheme {
  dark: boolean;
  colors: Record<ThemeColor, string>;
  /** Rounded corners, in points, from the theme's `radius`. */
  radius: number;
  /** The fonts the app loaded for the theme's, by family name, if it did; the phone's own otherwise. */
  fonts: { heading?: string; body?: string; mono?: string };
}

/** A CSS length in points, as the theme's radius is written: `0.5rem` is 8. */
function points(length: string | undefined, fallback: number): number {
  const match = /^(-?\d*\.?\d+)(rem|px|em)?$/.exec((length ?? "").trim());
  if (!match) return fallback;
  const value = Number(match[1]);
  return match[2] === "px" ? value : value * 16;
}

/**
 * The theme in light or dark colors. Dark colors are used only where the site
 * has dark mode (`theme.darkMode`), as on its pages.
 */
export function nativeTheme(
  settings: Pick<SiteSettings, "theme">,
  dark: boolean,
  fonts: NativeTheme["fonts"] = {},
): NativeTheme {
  const { theme } = settings;
  const darkShown = dark && theme.darkMode === true;
  const colors = Object.fromEntries(
    THEME_COLORS.map((name) => [
      name,
      darkShown ? darkThemeColor(theme, name) : (theme.colors[name] ?? DEFAULT_THEME_COLORS[name]),
    ]),
  ) as Record<ThemeColor, string>;
  return { dark: darkShown, colors, radius: points(theme.radius, points(DEFAULT_RADIUS, 8)), fonts };
}

/** The space blocks put between and around things, in points, by the sizes their props name. */
export const SPACE = { none: 0, sm: 12, md: 24, lg: 40, xl: 64 } as const;

/** Text sizes, in points, as the web blocks' Tailwind sizes are. */
export const TEXT = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48 } as const;
