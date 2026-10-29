/** Which of a block's classes apply on an app's screen, with no React Native, so it's tested in Node. */

/** Screen widths of Tailwind's breakpoints, in points, for classes such as `md:p-8`. */
const SCREENS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
const SCREEN_ORDER = Object.keys(SCREENS);

/**
 * The classes that apply on this screen, in the order Tailwind applies them:
 * plain ones, then each breakpoint's from the smallest (`sm:` from its width,
 * `max-sm:` below it, as Tailwind has them), then dark ones, which
 * apply only where the site has dark mode and shows it. Other variants, such
 * as `hover:`, have nothing to apply to in an app.
 */
export function appliedClasses(className: string, width: number, dark: boolean): string[] {
  const tiers: string[][] = [];
  for (const name of className.split(/\s+/).filter(Boolean)) {
    const variants = name.split(":");
    const base = variants.pop() ?? "";
    let tier = 0;
    let applies = true;
    for (const variant of variants) {
      const below = variant.startsWith("max-") ? SCREEN_ORDER.indexOf(variant.slice(4)) : -1;
      const screen = SCREEN_ORDER.indexOf(variant);
      if (below >= 0) {
        // `max-sm:` applies below `sm`, as the editor's choice to hide a block on phones writes it.
        applies &&= width < (SCREENS[variant.slice(4)] ?? 0);
        tier = Math.max(tier, below + 1);
      } else if (screen >= 0) {
        applies &&= width >= (SCREENS[variant] ?? Number.POSITIVE_INFINITY);
        tier = Math.max(tier, screen + 1);
      } else if (variant === "dark") {
        applies &&= dark;
        tier = Math.max(tier, SCREEN_ORDER.length + 1);
      } else applies = false;
    }
    if (!applies || !base) continue;
    tiers[tier] = [...(tiers[tier] ?? []), base];
  }
  return tiers.flatMap((tier) => tier ?? []);
}
