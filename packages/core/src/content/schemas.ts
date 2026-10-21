import { z } from "zod";
import { wallClock } from "../calendar.js";
import { addressPatternProblem } from "./paths.js";

/** Theme color names. They map to shadcn-compatible CSS variables (`primaryForeground` → `--primary-foreground`). */
export const THEME_COLORS = [
  "background",
  "foreground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "border",
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];

/**
 * A CSS color such as `#1e3a8a`, `rgb(30 58 138)` or `oklch(0.4 0.1 260)`.
 * Restricted to characters colors actually use, so a value can't break out of
 * the stylesheet it's written into.
 */
const cssColor = z
  .string()
  .regex(/^[#a-zA-Z0-9(),.%\s/+-]{1,100}$/, "must be a CSS color, such as #1e3a8a or rgb(30 58 138)");

/** A Google Fonts family name, such as `Inter` or `Cinzel Decorative`. */
const fontFamily = z.string().regex(/^[a-zA-Z0-9 ]{1,60}$/, "must be a font name, such as Inter or Cinzel Decorative");

/** A Shiki theme's name, such as `github-light`; `CODE_THEMES` lists the ones Goodfellow offers. */
const codeThemeName = z.string().regex(/^[a-z0-9-]{1,60}$/, "must be a code theme's name, such as github-light");

/** Google Fonts' kinds of font, which say what a font falls back to while it loads. */
export const FONT_CATEGORIES = ["sans-serif", "serif", "display", "handwriting", "monospace"] as const;
export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** A CSS length, such as `0.5rem` or `0`. */
const cssLength = z.string().regex(/^\d*\.?\d+(px|rem|em)?$/, "must be a size, such as 0.5rem or 8px");

const themeSchema = z.object({
  colors: z.partialRecord(z.enum(THEME_COLORS), cssColor).default({}),
  /**
   * Whether pages follow the visitor's light or dark setting. Off by default:
   * a site is light only until its owner turns this on in Site Settings.
   */
  darkMode: z.boolean().optional(),
  /** The theme's colors in dark mode. Colors left out are `DEFAULT_DARK_THEME_COLORS`'. Kept while dark mode is off. */
  darkColors: z.partialRecord(z.enum(THEME_COLORS), cssColor).optional(),
  fonts: z
    .object({
      heading: fontFamily.optional(),
      body: fontFamily.optional(),
      /** What kind of font each is, from Google Fonts' list, so pages fall back to a similar one. Sans serif if left out. */
      headingCategory: z.enum(FONT_CATEGORIES).optional(),
      bodyCategory: z.enum(FONT_CATEGORIES).optional(),
    })
    .default({}),
  radius: cssLength.optional(),
  /**
   * How code is colored: the themes for code in light colors and in dark
   * colors (`CODE_THEMES`; others fall back to `DEFAULT_CODE_THEMES`), and
   * whether code that's colored like the page keeps its theme's background
   * (`theme`, the default) or takes the site's panel color (`site`, `--muted`).
   */
  code: z
    .object({
      light: codeThemeName.optional(),
      dark: codeThemeName.optional(),
      background: z.enum(["theme", "site"]).optional(),
    })
    .optional(),
});

export const siteSettingsSchema = z.object({
  version: z.literal(1),
  title: z.string().default("My site"),
  description: z.string().default(""),
  /** The site's public address, such as `https://example.org`. Used for the sitemap and link previews. */
  url: z.url({ protocol: /^https?$/ }).optional(),
  language: z.string().default("en"),
  favicon: z.string().optional(),
  logo: z
    .object({
      src: z.string(),
      alt: z.string().default(""),
      /** The logo shown in dark mode, such as a light version, where the site has dark mode. */
      darkSrc: z.string().optional(),
    })
    .optional(),
  /** How page titles appear in browser tabs. `%s` is replaced by the page title. */
  titleTemplate: z.string().default("%s"),
  /** Image shown when a page is shared on social media, unless the page sets its own. */
  socialImage: z.string().optional(),
  /** Whether links to other sites open in a new tab, wherever they are: menus, buttons, rich text and Markdown. */
  externalLinksInNewTab: z.boolean().optional(),
  /** The time zone events' times are in, such as `America/New_York`. Without one, times are shown as they're written. */
  timeZone: z.string().optional(),
  /** How to get in touch, shown by the Contact details block wherever it's placed. */
  contact: z
    .object({
      /** A postal address; line breaks are kept. */
      address: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  /** Where forms' answers go (see `formTarget()`). Web3Forms unless another service is chosen. */
  forms: z
    .object({
      service: z.enum(["web3forms", "formspree", "other"]).default("web3forms"),
      /** Web3Forms' access key, which sends answers to the email address it was made for. */
      accessKey: z.string().optional(),
      /** Formspree's form address or ID, or another service's address forms post to. */
      address: z.string().optional(),
      /** Whether Web3Forms forms show hCaptcha, which loads Web3Forms' script on pages with a form. */
      captcha: z.boolean().optional(),
    })
    .optional(),
  theme: themeSchema.default({ colors: {}, fonts: {} }),
});

export type SiteSettings = z.output<typeof siteSettingsSchema>;
export type Theme = SiteSettings["theme"];

const menuLink = z.object({
  label: z.string(),
  href: z.string(),
});

const menuItem = menuLink.extend({
  children: z.array(menuLink).optional(),
});

export const menusFileSchema = z.object({
  version: z.literal(1),
  menus: z.record(z.string(), z.array(menuItem)).default({}),
});

export type MenusFile = z.output<typeof menusFileSchema>;

/** How the site updates Goodfellow (`content/updates.json`). */
export const updateSettingsSchema = z.object({
  version: z.literal(1),
  /** Whether the nightly update installs fixes on its own. */
  automatic: z.boolean().default(true),
  /** Releases updates never install on their own, such as one the site went back from. */
  skip: z.array(z.string()).default([]),
});

export type UpdateSettings = z.output<typeof updateSettingsSchema>;
export type Menus = MenusFile["menus"];
export type MenuItem = z.output<typeof menuItem>;

const componentData = z.looseObject({
  type: z.string().min(1),
  props: z.looseObject({ id: z.string().min(1) }),
});

/** Puck page data. Only the outline is checked here; blocks validate their own props. */
export const puckDataSchema = z.looseObject({
  root: z.looseObject({ props: z.record(z.string(), z.unknown()).optional() }).default({}),
  content: z.array(componentData).default([]),
});

/** A wall-clock date and time in the site's time zone, `YYYY-MM-DDTHH:MM`, as scheduled changes use. */
const scheduleTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "must be a date and time written as YYYY-MM-DDTHH:MM")
  .refine((value) => wallClock(value) !== undefined, "must be a date and time that exists");

/**
 * When a page or entry is on the site (see `schedule.ts`): from `showFrom`,
 * and until `hideAfter`, each in the site's time zone. Either can be left out.
 */
const scheduleShape = {
  showFrom: scheduleTime.optional(),
  hideAfter: scheduleTime.optional(),
};

function checkSchedule(file: { showFrom?: string; hideAfter?: string }, ctx: z.RefinementCtx) {
  if (file.showFrom && file.hideAfter && file.hideAfter <= file.showFrom) {
    ctx.addIssue({ code: "custom", path: ["hideAfter"], message: "must be after showFrom" });
  }
}

export const pageFileSchema = z
  .object({
    version: z.literal(1),
    ...scheduleShape,
    data: puckDataSchema,
  })
  .superRefine(checkSchedule);

export type PageFile = z.output<typeof pageFileSchema>;

/** The header and footer use the same format as pages, without a schedule. */
export const layoutFileSchema = z.object({
  version: z.literal(1),
  data: puckDataSchema,
});
export type LayoutFile = z.output<typeof layoutFileSchema>;

/** The kinds of information an entry can hold. */
export const FIELD_TYPES = [
  "text",
  "textarea",
  "richtext",
  "number",
  "date",
  "event",
  "link",
  "image",
  "select",
  "tags",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** A field's name, which also makes its placeholder: `speaker` → `{speaker}`. */
const fieldName = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "must use lowercase letters, numbers and hyphens, starting with a letter");

const fieldOption = z.object({
  value: z.string().min(1),
  label: z.string(),
});

const collectionField = z.object({
  name: fieldName,
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  /** Entries can't be published with this field empty. */
  required: z.boolean().optional(),
  /** Help shown under the field when editing an entry. */
  hint: z.string().optional(),
  /** The choices for a `select` field, or the tags a `tags` field offers. */
  options: z.array(fieldOption).optional(),
});

export type CollectionField = z.output<typeof collectionField>;
export type FieldOption = z.output<typeof fieldOption>;

/** Every collection has a title field, used for entries' names in lists and in the admin panel. */
export const TITLE_FIELD = "title";

export const collectionFileSchema = z
  .object({
    version: z.literal(1),
    /** What the collection is called, such as "Videos". */
    name: z.string().min(1),
    /** What one entry is called, such as "Video". */
    entryName: z.string().min(1),
    /**
     * The address of each entry's page, such as `/videos/{slug}`. Collections
     * without one have no pages of their own and are only shown in lists.
     */
    path: z.string().optional(),
    fields: z.array(collectionField).min(1),
    /** How entries are ordered in the admin panel and, by default, in lists. Defaults to by title. */
    sort: z.object({ field: fieldName, order: z.enum(["asc", "desc"]) }).optional(),
    /**
     * Stores entries as Markdown files (`<slug>.md`) instead of JSON. `body` names the
     * formatted-text field that is the file's Markdown; the other fields are its front matter.
     */
    markdown: z.object({ body: fieldName }).optional(),
    /**
     * Makes the collection a calendar: `when` names its event field, and `place`
     * and `summary` the fields calendars show beside each event. Builds write
     * its events as calendar files visitors can subscribe to.
     */
    calendar: z.object({ when: fieldName, place: fieldName.optional(), summary: fieldName.optional() }).optional(),
    /** The Puck layout every entry's page uses. */
    template: puckDataSchema.default({ root: {}, content: [] }),
  })
  .superRefine((file, ctx) => {
    const names = new Set<string>();
    file.fields.forEach((field, index) => {
      if (names.has(field.name)) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "name"], message: `is used by more than one field` });
      }
      names.add(field.name);
      if ((field.type === "select" || field.type === "tags") && !field.options?.length) {
        ctx.addIssue({ code: "custom", path: ["fields", index, "options"], message: "must list at least one choice" });
      }
    });
    const title = file.fields.find((field) => field.name === TITLE_FIELD);
    if (title?.type !== "text") {
      ctx.addIssue({ code: "custom", path: ["fields"], message: `must include a text field named "${TITLE_FIELD}"` });
    }
    if (file.path !== undefined) {
      const problem = addressPatternProblem(file.path);
      if (problem) ctx.addIssue({ code: "custom", path: ["path"], message: problem });
    }
    if (file.sort && !names.has(file.sort.field)) {
      ctx.addIssue({ code: "custom", path: ["sort", "field"], message: "must be one of the collection's fields" });
    }
    if (file.calendar) {
      const typeOf = (name: string | undefined) => file.fields.find((field) => field.name === name)?.type;
      if (typeOf(file.calendar.when) !== "event") {
        ctx.addIssue({
          code: "custom",
          path: ["calendar", "when"],
          message: "must be one of the collection's date and time fields",
        });
      }
      if (file.calendar.place !== undefined && !["text", "textarea"].includes(typeOf(file.calendar.place) ?? "")) {
        ctx.addIssue({
          code: "custom",
          path: ["calendar", "place"],
          message: "must be one of the collection's text fields",
        });
      }
      if (
        file.calendar.summary !== undefined &&
        !["text", "textarea", "richtext"].includes(typeOf(file.calendar.summary) ?? "")
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["calendar", "summary"],
          message: "must be one of the collection's text fields",
        });
      }
    }
    if (file.markdown) {
      const body = file.fields.find((field) => field.name === file.markdown?.body);
      if (body?.type !== "richtext") {
        ctx.addIssue({
          code: "custom",
          path: ["markdown", "body"],
          message: "must be one of the collection's formatted-text fields",
        });
      }
      // Front matter holds the version beside the fields, so no field can have its name.
      if (names.has("version")) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: 'can\'t include a field named "version" when entries are Markdown files',
        });
      }
    }
  });

export type CollectionFile = z.output<typeof collectionFileSchema>;

/** One entry: its field values, keyed by field name. Checked against its collection's fields when loaded. */
export const entryFileSchema = z
  .object({
    version: z.literal(1),
    ...scheduleShape,
    fields: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine(checkSchedule);

export type EntryFile = z.output<typeof entryFileSchema>;
