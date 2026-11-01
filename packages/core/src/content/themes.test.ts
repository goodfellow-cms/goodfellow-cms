import { describe, expect, it } from "vitest";
import { hashText } from "../registry.js";
import { CUSTOM_CSS_FILE, HEADER_FILE, SITE_FILE, THEME_FILE } from "./paths.js";
import type { LayoutFile, SiteSettings } from "./schemas.js";
import type { FileChange } from "./store.js";
import {
  parseThemeRecord,
  planTheme,
  type ThemePackage,
  type ThemeSite,
  themeCssLoads,
  themeCssRegion,
  themeFromValues,
  themeValues,
  withThemeCss,
} from "./themes.js";

const settings = (theme: Partial<SiteSettings["theme"]> = {}): SiteSettings =>
  ({
    version: 1,
    title: "St. Example",
    description: "",
    language: "en",
    titleTemplate: "%s",
    theme: { colors: {}, fonts: {}, ...theme },
  }) as SiteSettings;

const layout = (id: string): LayoutFile => ({
  version: 1,
  data: { root: { props: {} }, content: [{ type: "SiteBrand", props: { id, className: "", show: "both" } }] },
});

const harbor = (release: string, changes: Partial<ThemePackage> = {}): ThemePackage => ({
  name: "goodfellow-theme-harbor",
  release,
  goodfellow: "^0.30.0",
  manifest: {
    version: 1,
    title: "Harbor",
    theme: {
      colors: { primary: "#1e3a5f", background: "#fbfaf7" },
      fonts: { heading: "Merriweather" },
      radius: "0.75rem",
      parts: { "gf-button": "rounded-full" },
    },
  },
  css: ".gf-card { box-shadow: none; }",
  header: layout("SiteBrand-harbor"),
  ...changes,
});

const site = (changes: Partial<ThemeSite> = {}): ThemeSite => ({
  settings: settings({ colors: { primary: "#1e3a8a", border: "#e2e8f0" }, fonts: { body: "Inter" } }),
  customCss: ".mine { color: red; }\n",
  header: layout("SiteBrand-mine"),
  footer: layout("SiteBrand-footer"),
  ...changes,
});

/** A change's text, or `undefined` for one that deletes its file. */
const text = (change: FileChange | undefined) => (change && "content" in change ? change.content : undefined);

/** The site as a plan leaves it, with the record it wrote. */
function after(plan: Awaited<ReturnType<typeof planTheme>>, before: ThemeSite): ThemeSite {
  const record = plan.changes.find((change) => change.path === THEME_FILE);
  return {
    settings: plan.settings,
    customCss: plan.customCss,
    header: plan.header,
    footer: plan.footer,
    record: record ? parseThemeRecord(text(record)) : before.record,
  };
}

describe("theme values", () => {
  it("lists every setting one by one, and makes the same settings again", () => {
    const theme = {
      colors: { primary: "#1e3a5f" },
      darkColors: { background: "#000000" },
      darkMode: true,
      fonts: { heading: "Merriweather", headingCategory: "serif" as const },
      radius: "0.5rem",
      code: { light: "github-light" },
      parts: { "gf-card": "rounded-xl" },
    };
    const values = themeValues(theme);
    expect(values).toEqual({
      "colors.primary": "#1e3a5f",
      "darkColors.background": "#000000",
      "fonts.heading": "Merriweather",
      "fonts.headingCategory": "serif",
      "code.light": "github-light",
      "parts.gf-card": "rounded-xl",
      darkMode: true,
      radius: "0.5rem",
    });
    expect(themeFromValues(values)).toEqual(theme);
  });
});

describe("the theme's CSS", () => {
  it("goes at the start of the custom CSS, between marks, and is replaced and removed there", () => {
    const css = withThemeCss(".mine {}\n", { name: "goodfellow-theme-harbor", release: "1.0.0", css: ".a {}" });
    expect(css).toBe(
      "/* Theme CSS: goodfellow-theme-harbor 1.0.0. An update replaces it unless it's changed. */\n.a {}\n/* End of theme CSS */\n\n.mine {}\n",
    );
    expect(themeCssRegion(css)).toEqual({ name: "goodfellow-theme-harbor", css: ".a {}" });
    const replaced = withThemeCss(css, { name: "goodfellow-theme-harbor", release: "1.1.0", css: ".b {}" });
    expect(themeCssRegion(replaced)?.css).toBe(".b {}");
    expect(replaced.endsWith("\n\n.mine {}\n")).toBe(true);
    expect(withThemeCss(css, undefined)).toBe(".mine {}\n");
  });

  it("lists what it loads besides Google Fonts and the site's media", () => {
    const css = `
      @import url("https://fonts.googleapis.com/css2?family=Inter");
      @import "https://tracker.example/style.css";
      /* url(https://in-a-comment.example/x.png) */
      .a { background: url(/media/paper.png), url('https://images.example/paper.png'); }
      .b { background: url(data:image/png;base64,AAAA); src: url(https://fonts.gstatic.com/s/inter.woff2); }
      .c { background-image: url( other.png ); }
    `;
    expect(themeCssLoads(css)).toEqual([
      "https://images.example/paper.png",
      "https://tracker.example/style.css",
      "other.png",
    ]);
  });
});

describe("planTheme", () => {
  it("keeps the site's own fonts, which are its files", async () => {
    const custom = [{ family: "Brandon", files: [{ src: "/media/fonts/brandon-400.woff2", weight: 400 }] }];
    const before = site({ settings: settings({ colors: {}, fonts: { body: "Brandon", custom } }) });
    const plan = await planTheme(before, harbor("1.0.0"));
    expect(plan.settings.theme.fonts).toEqual({ heading: "Merriweather", body: "Brandon", custom });
    const removed = await planTheme(after(plan, before), undefined);
    expect(removed.settings.theme.fonts.custom).toEqual(custom);
  });

  it("installs a theme's settings, CSS and record, keeping settings it doesn't give", async () => {
    const before = site();
    const plan = await planTheme(before, harbor("1.0.0"));
    expect(plan.settings.theme).toEqual({
      colors: { primary: "#1e3a5f", background: "#fbfaf7", border: "#e2e8f0" },
      fonts: { heading: "Merriweather", body: "Inter" },
      radius: "0.75rem",
      parts: { "gf-button": "rounded-full" },
    });
    expect(themeCssRegion(plan.customCss)?.css).toBe(".gf-card { box-shadow: none; }");
    expect(plan.customCss).toContain(".mine { color: red; }");
    // The header is used only when asked.
    expect(plan.header).toBe(before.header);
    expect(plan.changes.map((change) => change.path)).toEqual([SITE_FILE, CUSTOM_CSS_FILE, THEME_FILE]);
    const record = parseThemeRecord(text(plan.changes.find((change) => change.path === THEME_FILE)));
    expect(record).toMatchObject({ name: "goodfellow-theme-harbor", release: "1.0.0", goodfellow: "^0.30.0" });
    expect(record?.css).toBe(await hashText(".gf-card { box-shadow: none; }"));
    expect(record?.header).toBeUndefined();
  });

  it("uses the theme's header when asked", async () => {
    const plan = await planTheme(site(), harbor("1.0.0"), { layout: true });
    expect(plan.header.data.content[0]?.props.id).toBe("SiteBrand-harbor");
    expect(plan.changes.map((change) => change.path)).toContain(HEADER_FILE);
  });

  it("updates only what nobody changed, and lists what it kept", async () => {
    const installed = after(await planTheme(site(), harbor("1.0.0"), { layout: true }), site());
    // The owner changes the primary color, the CSS and the header.
    const changed: ThemeSite = {
      ...installed,
      settings: {
        ...installed.settings,
        theme: { ...installed.settings.theme, colors: { ...installed.settings.theme.colors, primary: "#7c2d12" } },
      },
      customCss: installed.customCss.replace("box-shadow: none", "box-shadow: 0 0 1px"),
      header: layout("SiteBrand-changed"),
    };
    const next = harbor("1.1.0", {
      manifest: {
        version: 1,
        title: "Harbor",
        theme: {
          colors: { primary: "#14324f", background: "#ffffff" },
          fonts: { heading: "Merriweather" },
          parts: { "gf-button": "rounded-full" },
        },
      },
      css: ".gf-card { box-shadow: 0 1px 2px black; }",
      header: layout("SiteBrand-harbor-2"),
    });
    const plan = await planTheme(changed, next);
    expect(plan.settings.theme.colors).toEqual({ primary: "#7c2d12", background: "#ffffff", border: "#e2e8f0" });
    // The release left out the radius, which nobody had changed.
    expect(plan.settings.theme.radius).toBeUndefined();
    expect(themeCssRegion(plan.customCss)?.css).toBe(".gf-card { box-shadow: 0 0 1px; }");
    expect(plan.header.data.content[0]?.props.id).toBe("SiteBrand-changed");
    expect(plan.kept).toEqual([{ kind: "setting", key: "colors.primary" }, { kind: "css" }, { kind: "header" }]);
    expect(plan.replaced).toEqual([]);

    // What nobody changed follows the theme.
    const untouched = await planTheme(installed, next);
    expect(untouched.settings.theme.colors.primary).toBe("#14324f");
    expect(themeCssRegion(untouched.customCss)?.css).toBe(".gf-card { box-shadow: 0 1px 2px black; }");
    expect(untouched.header.data.content[0]?.props.id).toBe("SiteBrand-harbor-2");
    expect(untouched.kept).toEqual([]);
  });

  it("replaces the theme before, listing owners' changes it replaces", async () => {
    const installed = after(await planTheme(site(), harbor("1.0.0")), site());
    const changed: ThemeSite = {
      ...installed,
      settings: { ...installed.settings, theme: { ...installed.settings.theme, radius: "0.25rem" } },
    };
    const meadow: ThemePackage = {
      name: "goodfellow-theme-meadow",
      release: "2.0.0",
      manifest: { version: 1, title: "Meadow", theme: { colors: { primary: "#365314" }, fonts: {}, radius: "1rem" } },
    };
    const plan = await planTheme(changed, meadow);
    // Harbor's background and heading font, which nobody changed, are gone.
    expect(plan.settings.theme).toEqual({
      colors: { primary: "#365314", border: "#e2e8f0" },
      fonts: { body: "Inter" },
      radius: "1rem",
      parts: undefined,
    });
    expect(themeCssRegion(plan.customCss)).toBeUndefined();
    expect(plan.customCss).toBe(".mine { color: red; }\n");
    expect(plan.replaced).toEqual([{ kind: "setting", key: "radius" }]);
  });

  it("removes the theme, leaving owners' changes and the header", async () => {
    const installed = after(await planTheme(site(), harbor("1.0.0"), { layout: true }), site());
    const changed: ThemeSite = {
      ...installed,
      settings: { ...installed.settings, theme: { ...installed.settings.theme, radius: "0.25rem" } },
    };
    const plan = await planTheme(changed, undefined);
    expect(plan.settings.theme.radius).toBe("0.25rem");
    expect(plan.settings.theme.colors).toEqual({ border: "#e2e8f0" });
    expect(plan.header).toBe(changed.header);
    expect(plan.customCss).toBe(".mine { color: red; }\n");
    expect(plan.changes.find((change) => change.path === THEME_FILE)).toEqual({ path: THEME_FILE, delete: true });
  });

  it("changes nothing when the same release is installed again", async () => {
    const installed = after(await planTheme(site(), harbor("1.0.0")), site());
    const plan = await planTheme(installed, harbor("1.0.0"));
    expect(plan.changes.map((change) => change.path)).toEqual([THEME_FILE]);
  });
});
