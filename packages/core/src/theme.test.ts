import { describe, expect, it } from "vitest";
import { colorSchemeScript } from "./color-scheme.js";
import { isPartName, siteSettingsSchema } from "./content/schemas.js";
import {
  codeStyle,
  colorSchemeMeta,
  DEFAULT_CODE_THEMES,
  escapeStyleText,
  googleFontsUrl,
  themeToCss,
} from "./theme.js";

const theme = (input: object) => siteSettingsSchema.parse({ version: 1, theme: input }).theme;

describe("themeToCss", () => {
  it("fills in defaults and uses shadcn variable names", () => {
    const css = themeToCss(theme({ colors: { primary: "#1e3a8a", primaryForeground: "white" } }));
    expect(css).toMatch(/^:root\{/);
    expect(css).toContain("--primary:#1e3a8a;");
    expect(css).toContain("--primary-foreground:white;");
    expect(css).toContain("--background:#ffffff;");
    expect(css).toContain("--radius:0.5rem;");
    expect(css).toContain("--gf-font-heading:var(--gf-font-body)");
  });

  it("uses the theme's fonts with fallbacks", () => {
    const css = themeToCss(theme({ fonts: { heading: "Cinzel", body: "Lato" } }));
    expect(css).toContain('--gf-font-heading:"Cinzel", ui-sans-serif');
    expect(css).toContain('--gf-font-body:"Lato", ui-sans-serif');
  });

  it("falls back to the computer's fonts of the same kind", () => {
    const css = themeToCss(
      theme({ fonts: { heading: "Fraunces", headingCategory: "serif", body: "Fira Code", bodyCategory: "monospace" } }),
    );
    expect(css).toContain('--gf-font-heading:"Fraunces", ui-serif, Georgia,');
    expect(css).toContain('--gf-font-body:"Fira Code", ui-monospace,');
    expect(themeToCss(theme({ fonts: { heading: "Bangers", headingCategory: "display" } }))).toContain(
      '--gf-font-heading:"Bangers", ui-sans-serif',
    );
  });
});

describe("dark mode", () => {
  it("is off unless the site turns it on, keeping its dark colors meanwhile", () => {
    const light = theme({ darkColors: { background: "#000000" } });
    expect(themeToCss(light)).not.toContain("prefers-color-scheme");
    expect(themeToCss(light)).not.toContain("color-scheme");
    expect(colorSchemeMeta(light)).toBeUndefined();
    expect(light.darkColors).toEqual({ background: "#000000" });
  });

  it("follows the visitor's setting, and previews can show either", () => {
    const css = themeToCss(theme({ darkMode: true, darkColors: { primary: "#93c5fd" } }));
    expect(css).toContain(":root{color-scheme:light dark}");
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-gf-color-scheme="light"\]\)\{[^}]*--primary:#93c5fd;/,
    );
    // Colors the site doesn't set come from the default dark theme.
    expect(css).toContain("--background:#0a0a0a");
    expect(css).toMatch(/:root\[data-gf-color-scheme="dark"\]\{[^}]*--primary:#93c5fd;[^}]*color-scheme:dark\}/);
    expect(css).toContain(':root[data-gf-color-scheme="light"]{color-scheme:light}');
    expect(colorSchemeMeta(theme({ darkMode: true }))).toBe("light dark");
  });
});

describe("the visitor's choice from the Dark mode switch", () => {
  it("is put back before the page shows, on sites with dark mode only", () => {
    expect(colorSchemeScript(theme({}))).toBeUndefined();
    const script = colorSchemeScript(theme({ darkMode: true })) ?? "";
    const root = {
      attributes: {} as Record<string, string>,
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
    };
    const run = (stored: string | null) => {
      root.attributes = {};
      new Function("localStorage", "document", script)({ getItem: () => stored }, { documentElement: root });
      return root.attributes;
    };
    expect(run("dark")).toEqual({ "data-gf-color-scheme": "dark" });
    expect(run("light")).toEqual({ "data-gf-color-scheme": "light" });
    expect(run(null)).toEqual({});
    expect(run("purple")).toEqual({});
    // Storage that can't be read, as in some private windows, leaves the page following the computer.
    expect(() =>
      new Function("localStorage", "document", script)(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        { documentElement: root },
      ),
    ).not.toThrow();
  });
});

describe("codeStyle", () => {
  it("uses GitHub's themes and their backgrounds unless the site chooses others", () => {
    expect(codeStyle(theme({}))).toEqual({ ...DEFAULT_CODE_THEMES, siteBackground: false, darkMode: false });
    expect(codeStyle(undefined)).toEqual({ ...DEFAULT_CODE_THEMES, siteBackground: false, darkMode: false });
    expect(
      codeStyle(
        theme({ darkMode: true, code: { light: "everforest-light", dark: "everforest-dark", background: "site" } }),
      ),
    ).toEqual({ light: "everforest-light", dark: "everforest-dark", siteBackground: true, darkMode: true });
  });

  it("falls back to the defaults for themes Goodfellow doesn't offer, or on the wrong side", () => {
    expect(codeStyle(theme({ code: { light: "github-dark", dark: "no-such-theme" } }))).toMatchObject(
      DEFAULT_CODE_THEMES,
    );
  });

  it("refuses names that aren't theme names", () => {
    expect(() => theme({ code: { light: "../themes/x" } })).toThrow();
  });
});

describe("googleFontsUrl", () => {
  it("requests each font once", () => {
    expect(googleFontsUrl(theme({ fonts: { heading: "Cinzel Decorative", body: "Cinzel Decorative" } }))).toBe(
      "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;500;600;700&display=swap",
    );
  });

  it("returns nothing without fonts", () => {
    expect(googleFontsUrl(theme({}))).toBeUndefined();
  });
});

describe("escapeStyleText", () => {
  it("prevents closing the style element", () => {
    const escaped = escapeStyleText("a{} </style><script>alert(1)</script> </STYLE> <!--");
    expect(escaped).not.toMatch(/<\/style/i);
    expect(escaped).not.toContain("<!--");
  });
});

describe("blocks' parts", () => {
  it("names parts gf- and lowercase words", () => {
    expect(isPartName("gf-card-title")).toBe(true);
    expect(isPartName("gf-code")).toBe(true);
    expect(isPartName("card-title")).toBe(false);
    expect(isPartName("gf-card--title")).toBe(false);
    expect(isPartName("gf-")).toBe(false);
  });

  it("keeps classes for parts by name", () => {
    expect(theme({ parts: { "gf-card-title": "text-xl", "gf-heading": "tracking-tight" } }).parts).toEqual({
      "gf-card-title": "text-xl",
      "gf-heading": "tracking-tight",
    });
  });

  it("refuses names that aren't parts' and classes that could close an attribute or tag", () => {
    expect(() => theme({ parts: { heading: "text-xl" } })).toThrow(/part's name/);
    expect(() => theme({ parts: { "gf-Heading": "text-xl" } })).toThrow(/part's name/);
    expect(() => theme({ parts: { "gf-heading": "text-xl<script>" } })).toThrow(/CSS classes/);
    expect(() => theme({ parts: { "gf-heading": "text-xl\nfoo" } })).toThrow(/CSS classes/);
  });
});
