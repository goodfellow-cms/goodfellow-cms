/**
 * Tailwind classes as React Native styles, for the classes blocks' Style
 * settings keep in their `className` (alignment, text size, colors, space
 * inside and around, rounded corners) and any others editors typed. They're
 * read with twrnc while the app runs, since content brings classes no build
 * of the app has seen, with the site's theme colors, corners and fonts as the
 * site's Tailwind has them. Classes React Native has nothing like (grids,
 * hover states, the site's own CSS classes) are left out.
 */
import { colorSlug, type SiteSettings, THEME_COLORS } from "@goodfellow-cms/core";
import type { TextStyle, ViewStyle } from "react-native";
import { create, type TailwindFn } from "twrnc";
import { appliedClasses } from "./applied-classes.js";
import { type NativeTheme, nativeTheme } from "./theme.js";

/** A block's classes as styles: what its box takes, and what its text takes, since text in React Native doesn't inherit. */
export interface ClassStyle {
  view: ViewStyle;
  text: TextStyle;
}

const TEXT_KEYS = new Set<string>([
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textAlign",
  "textDecorationColor",
  "textDecorationLine",
  "textDecorationStyle",
  "textShadowColor",
  "textShadowOffset",
  "textShadowRadius",
  "textTransform",
]);

const made = new Map<string, TailwindFn>();

/** A Tailwind for the theme: its colors by their names in classes, its corners and its fonts. */
function tailwindFor(theme: NativeTheme): TailwindFn {
  const { radius, fonts } = theme;
  const colors = Object.fromEntries(THEME_COLORS.map((name) => [colorSlug(name), theme.colors[name]]));
  const key = JSON.stringify([colors, radius, fonts]);
  const known = made.get(key);
  if (known) return known;
  const fontFamily = Object.fromEntries(
    Object.entries({ sans: fonts.body, heading: fonts.heading, mono: fonts.mono }).filter(([, font]) => font),
  ) as Record<string, string>;
  const tw = create({
    theme: {
      extend: {
        colors,
        // As the site's theme.css has them, from the theme's radius.
        borderRadius: {
          sm: `${Math.max(0, radius - 4)}px`,
          md: `${Math.max(0, radius - 2)}px`,
          lg: `${radius}px`,
          xl: `${radius + 4}px`,
        },
        fontFamily,
      },
    },
  });
  // A few themes at most: light and dark, and the colors bands of another color give blocks.
  if (made.size > 16) made.clear();
  made.set(key, tw);
  return tw;
}

/**
 * A block's classes as styles on a screen this wide, with the site's theme as
 * its Tailwind has it (`settings`), light or dark as the app shows it.
 */
export function classStyle(
  className: unknown,
  { settings, theme, width }: { settings: Pick<SiteSettings, "theme">; theme: NativeTheme; width: number },
): ClassStyle {
  const style: ClassStyle = { view: {}, text: {} };
  if (typeof className !== "string" || !className.trim()) return style;
  const classes = appliedClasses(className, width, theme.dark);
  if (classes.length === 0) return style;
  // The site's own colors, not those a band of another color gives the blocks on it.
  const tw = tailwindFor(nativeTheme(settings, theme.dark, theme.fonts));
  // twrnc warns about every class it has no style for, and most of a website's have none.
  const warn = console.warn;
  console.warn = () => {};
  let styles: Record<string, unknown> = {};
  try {
    styles = tw.style(classes) as Record<string, unknown>;
  } catch {
    // Content brings classes no build has seen, and one twrnc can't read throws: the rest still apply, each on its own.
    for (const name of classes) {
      try {
        Object.assign(styles, tw.style(name));
      } catch {
        // Left out.
      }
    }
  } finally {
    console.warn = warn;
  }
  for (const [key, value] of Object.entries(styles)) {
    if (TEXT_KEYS.has(key)) (style.text as Record<string, unknown>)[key] = value;
    else (style.view as Record<string, unknown>)[key] = value;
  }
  return style;
}

/** Whether a style has anything in it. */
export function hasStyle(style: ViewStyle | TextStyle): boolean {
  return Object.keys(style).length > 0;
}
