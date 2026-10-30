import { blocks, categories } from "@goodfellow-cms/blocks";
import { englishHash } from "@goodfellow-cms/core";
import { createPuckConfig } from "@goodfellow-cms/react";
import type { Config, Field, Fields } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { ADMIN_LANGUAGES, browserAdminLanguage, composeAdminText, showsEnglish } from "./admin-language.js";
import { withLabels } from "./frame/labels.js";
import { labels as spanishLabels } from "./languages/es-labels.js";
import { puck as spanishPuck } from "./languages/es-puck.js";
import { strings as spanish } from "./languages/es-strings.js";
import { defaultStrings } from "./strings.js";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("defaultStrings", () => {
  it("never uses git jargon", () => {
    for (const [key, text] of Object.entries(defaultStrings)) {
      expect(text, key).not.toMatch(/\b(commit|push|pull request|merge request|branch|repository|repo)\b/i);
    }
  });
});

describe("the Spanish admin panel", () => {
  it("has every string, with the same placeholders", () => {
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(defaultStrings).sort());
    for (const [key, text] of Object.entries(defaultStrings)) {
      expect(placeholders(spanish[key as keyof typeof spanish]), key).toEqual(placeholders(text));
    }
  });

  it("never uses git jargon", () => {
    for (const [key, text] of Object.entries(spanish)) {
      expect(text, key).not.toMatch(
        /(?<![\p{L}])(commit|push|pull request|merge request|branch|rama|ramas|repositorio|repositorios|repo|fusión|fusionar|confirmación)(?![\p{L}])/iu,
      );
    }
  });

  it("translates every label of the built-in blocks and their groups, keeping placeholders", () => {
    const config = createPuckConfig({ blocks, categories }, "page") as unknown as Config;
    const missing = new Set<string>();
    const visit = (fields: Fields | undefined) => {
      for (const field of Object.values(fields ?? {}) as (Field & Record<string, unknown>)[]) {
        if (typeof field.label === "string" && !spanishLabels[field.label]) missing.add(field.label);
        for (const option of Array.isArray(field.options) ? (field.options as { label: string }[]) : []) {
          if (!spanishLabels[option.label]) missing.add(option.label);
        }
        visit(field.arrayFields as Fields | undefined);
        visit(field.objectFields as Fields | undefined);
      }
    };
    for (const component of Object.values(config.components)) {
      if (component.label && !spanishLabels[component.label]) missing.add(component.label);
      visit(component.fields as Fields | undefined);
    }
    visit(config.root?.fields as Fields | undefined);
    for (const category of Object.values(config.categories ?? {})) {
      if (category.title && !spanishLabels[category.title]) missing.add(category.title);
    }
    expect([...missing].sort()).toEqual([]);
    for (const [english, text] of Object.entries(spanishLabels)) {
      expect(placeholders(text), english).toEqual(placeholders(english));
    }
  });

  it("gives Puck's own text, keeping its placeholders", () => {
    expect(spanishPuck["header-publish"]).toBe(spanish["publish.button"]);
    expect(placeholders(spanishPuck["viewport-switch"] ?? "")).toEqual(["{label}"]);
  });
});

describe("the admin panel's language", () => {
  it("follows the browser's first language it speaks, by its main part", () => {
    expect(ADMIN_LANGUAGES.map(({ code }) => code)).toEqual(["en", "es"]);
    expect(browserAdminLanguage(["es-MX", "en-US"])).toBe("es");
    expect(browserAdminLanguage(["fr-FR", "es"])).toBe("es");
    expect(browserAdminLanguage(["fr-FR"])).toBe("en");
    expect(browserAdminLanguage([])).toBe("en");
    // With the site's own languages, the whole tag first.
    expect(browserAdminLanguage(["pt-BR", "es"], ["en", "es", "pt-BR", "pt"])).toBe("pt-BR");
    expect(browserAdminLanguage(["fr-CA"], ["en", "es", "fr"])).toBe("fr");
  });
});

describe("the admin panel in a site's own language", () => {
  const french = {
    version: 1 as const,
    name: "Français",
    strings: {
      "publish.button": { text: "Publier", source: englishHash(defaultStrings["publish.button"]) },
      "deletePage.body": { text: "La page {path} sera supprimée." },
      "nav.pages": { text: "Les pages" },
      "nav.media": { text: "Médias {extra}" },
    },
    puck: { "header-publish": { text: "Publier" } },
    labels: { "Link text": { text: "Texte du lien" } },
  };

  it("takes the site's strings that can be used, and English for the rest", () => {
    const text = composeAdminText(undefined, french);
    expect(text.strings["publish.button"]).toBe("Publier");
    expect(text.strings["nav.pages"]).toBe("Les pages");
    // A string with other placeholders than the English's is left to the English.
    expect(text.strings["nav.media"]).toBe(defaultStrings["nav.media"]);
    expect(text.strings["app.title"]).toBe(defaultStrings["app.title"]);
    expect(Object.keys(text.strings).sort()).toEqual(Object.keys(defaultStrings).sort());
    expect(text.puck["header-publish"]).toBe("Publier");
    expect(text.labels["Link text"]).toBe("Texte du lien");
  });

  it("shows the English beside the site's words where a wrong translation could cost something", () => {
    const text = composeAdminText(undefined, french);
    expect(text.strings["deletePage.body"]).toBe(
      `La page {path} sera supprimée. (${defaultStrings["deletePage.body"]})`,
    );
    expect(showsEnglish("signIn.token.step1")).toBe(true);
    expect(showsEnglish("owner.token.paste")).toBe(true);
    expect(showsEnglish("draft.discardBody")).toBe(true);
    expect(showsEnglish("unsaved.confirm")).toBe(true);
    expect(showsEnglish("publish.button")).toBe(false);
    expect(showsEnglish("nav.pages")).toBe(false);
  });

  it("lays the site's words over Goodfellow's own translation, which fills in the rest", () => {
    const text = composeAdminText({ strings: spanish, puck: spanishPuck, labels: spanishLabels }, french);
    expect(text.strings["publish.button"]).toBe("Publier");
    expect(text.strings["app.title"]).toBe(spanish["app.title"]);
    expect(text.labels["Link text"]).toBe("Texte du lien");
    expect(text.puck["viewport-switch"]).toBe(spanishPuck["viewport-switch"]);
    // Without a file of the site's, Goodfellow's own as it is.
    const shipped = { strings: spanish, puck: spanishPuck, labels: spanishLabels };
    expect(composeAdminText(shipped, undefined)).toBe(shipped);
  });
});

describe("withLabels", () => {
  it("puts blocks' names, settings' labels, choices and groups in another language, leaving values alone", async () => {
    const config: Config = {
      categories: { layout: { title: "Layout", components: ["Box"] } },
      components: {
        Box: {
          label: "Section",
          fields: {
            size: {
              type: "select",
              label: "Size",
              options: [
                { label: "Small", value: "sm" },
                { label: "Huge", value: "xl" },
              ],
            },
            items: { type: "array", label: "Links", arrayFields: { text: { type: "text", label: "Link text" } } },
          },
          resolveFields: async () => ({ heading: { type: "text", label: "Heading" } }),
          render: () => null as never,
        },
      },
    };
    const labeled = withLabels(config, spanishLabels);
    const box = labeled.components.Box;
    expect(labeled.categories?.layout?.title).toBe("Diseño");
    expect(box?.label).toBe("Sección");
    expect(box?.fields?.size).toMatchObject({
      label: "Tamaño",
      // One the table doesn't have stays as it is.
      options: [
        { label: "Pequeño", value: "sm" },
        { label: "Huge", value: "xl" },
      ],
    });
    expect(box?.fields?.items).toMatchObject({
      label: "Enlaces",
      arrayFields: { text: { label: "Texto del enlace" } },
    });
    const resolved = await box?.resolveFields?.({} as never, {} as never);
    expect(resolved?.heading?.label).toBe("Título");
    expect(withLabels(config, {})).toBe(config);
  });
});
