import type { FontStandIns } from "@goodfellow-cms/core";

/**
 * The font stand-ins `withGoodfellow()` works out while `next build` loads the
 * config, with the fonts they're for, which it puts in the env as
 * `GOODFELLOW_FONT_STAND_INS`, so the server's code never includes Fontaine's
 * measurements.
 */
export interface BuiltFontStandIns {
  heading?: string;
  body?: string;
  standIns: FontStandIns;
}
