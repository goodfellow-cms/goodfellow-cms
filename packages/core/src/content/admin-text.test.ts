import { describe, expect, it } from "vitest";
import { isSettingsPath } from "../app-api.js";
import {
  ADMIN_TEXT_INDEX,
  type AdminTextFile,
  adminTextCode,
  adminTextFile,
  adminTextFileChange,
  adminTextOverlay,
  adminTextProblem,
  adminTextTable,
  englishHash,
  parseAdminTextIndex,
  publishedAdminText,
  readAdminText,
} from "./admin-text.js";
import type { ContentSource } from "./load.js";
import { serializeContent } from "./serialize.js";

const english = {
  "publish.button": "Publish",
  "pages.deleteConfirm": "Delete {title}? This can't be undone.",
  "app.title": "Admin",
};

const french: AdminTextFile = {
  version: 1,
  name: "Français",
  strings: {
    "publish.button": { text: "Publier", source: englishHash("Publish") },
    "pages.deleteConfirm": { text: "Supprimer {title} ? C'est définitif.", source: englishHash("Delete {title}?") },
  },
  puck: { "header-publish": { text: "Publier" } },
  labels: { "Link text": { text: "Texte du lien" } },
};

function memorySource(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

describe("the admin panel's text in a site's languages", () => {
  it("keeps a file for each language, which only owners change", () => {
    expect(adminTextFile("fr")).toBe("content/admin-text/fr.json");
    expect(adminTextCode("content/admin-text/pt-BR.json")).toBe("pt-BR");
    expect(adminTextCode("content/admin-text/notes.txt")).toBeUndefined();
    expect(adminTextCode("content/admin-text/sub/fr.json")).toBeUndefined();
    expect(adminTextCode("content/admin-text/French.json")).toBeUndefined();
    expect(isSettingsPath("content/admin-text/fr.json")).toBe(true);
  });

  it("uses a string only with the English's placeholders, and never with git's words", () => {
    expect(adminTextProblem("Publier", "Publish")).toBeUndefined();
    expect(adminTextProblem("  ", "Publish")).toBe("empty");
    expect(adminTextProblem("Supprimer ?", "Delete {title}?")).toBe("placeholders");
    expect(adminTextProblem("Supprimer {titre} ?", "Delete {title}?")).toBe("placeholders");
    expect(adminTextProblem("Supprimer {title} {extra}", "Delete {title}?")).toBe("placeholders");
    expect(adminTextProblem("x".repeat(2001), "Publish")).toBe("too-long");
    expect(adminTextProblem("Faire un commit", "Publish")).toBe("git-terms");
    expect(adminTextProblem("Créer une pull request", "Submit for review")).toBe("git-terms");
    // A word that only contains one, and English that uses one itself, as screens for developers do.
    expect(adminTextProblem("Repousser", "Publish")).toBeUndefined();
    expect(adminTextProblem("Dépôt de code", "Code repository")).toBeUndefined();
    expect(adminTextProblem("Repository du code", "Code repository")).toBeUndefined();
  });

  it("gives every English string, from the file where it can, else Goodfellow's translation, else the English", () => {
    const made = adminTextTable(english, french.strings, { "app.title": "Administración" });
    expect(made.table).toEqual({
      "publish.button": "Publier",
      "pages.deleteConfirm": "Supprimer {title} ? C'est définitif.",
      "app.title": "Administración",
    });
    expect([...made.fromFile].sort()).toEqual(["pages.deleteConfirm", "publish.button"]);
    // Made from English that has changed since.
    expect(made.outdated).toEqual(["pages.deleteConfirm"]);
    expect(made.missing).toEqual(["app.title"]);

    const broken = adminTextTable(english, {
      "publish.button": { text: "" },
      "pages.deleteConfirm": { text: "Supprimer ?" },
      "app.title": { text: "Le commit" },
      "gone.key": { text: "Ancien" },
    });
    expect(broken.table).toEqual(english);
    expect(broken.problems).toEqual([
      { key: "publish.button", problem: "empty" },
      { key: "pages.deleteConfirm", problem: "placeholders" },
      { key: "app.title", problem: "git-terms" },
    ]);
    expect(broken.table).not.toHaveProperty("gone.key");
  });

  it("lays a file's labels and Puck's text over Goodfellow's, checking labels against their English", () => {
    expect(
      adminTextOverlay(
        { "Size {n}": { text: "Taille {n}" }, Size: { text: "Taille {n}" } },
        {},
        { keyedByEnglish: true },
      ),
    ).toEqual({
      "Size {n}": "Taille {n}",
    });
    expect(
      adminTextOverlay(
        { "header-publish": { text: "Publier" }, "viewport-switch": { text: "Voir" } },
        {
          "viewport-switch": "Ver {label}",
        },
      ),
    ).toEqual({ "header-publish": "Publier", "viewport-switch": "Ver {label}" });
  });

  it("reads the site's languages, leaving out files that can't be read rather than failing", async () => {
    const source = memorySource({
      "content/admin-text/fr.json": serializeContent(french),
      "content/admin-text/de.json": "{ not JSON",
      "content/admin-text/it.json": serializeContent({ version: 1, strings: {} }),
      "content/admin-text/README.md": "Notes",
    });
    const { files, problems } = await readAdminText(source);
    expect(Object.keys(files)).toEqual(["fr"]);
    expect(files.fr?.strings["publish.button"]?.text).toBe("Publier");
    expect(problems.map((problem) => problem.file)).toEqual([
      "content/admin-text/de.json",
      "content/admin-text/it.json",
    ]);
    expect(await readAdminText(memorySource({}))).toEqual({ files: {}, problems: [] });
  });

  it("publishes them beside the admin panel, with an index of their names, for the sign-in screen", () => {
    expect(publishedAdminText({})).toEqual([]);
    const published = publishedAdminText({ fr: french, "pt-BR": { ...french, name: "Português" } });
    expect(published.map((file) => file.path)).toEqual([
      ADMIN_TEXT_INDEX,
      "admin/text/fr.json",
      "admin/text/pt-BR.json",
    ]);
    expect(parseAdminTextIndex(published[0]?.content ?? "")).toEqual([
      { code: "fr", name: "Français" },
      { code: "pt-BR", name: "Português" },
    ]);
    expect(parseAdminTextIndex("{}")).toEqual([]);
    expect(parseAdminTextIndex("nope")).toEqual([]);
    expect(
      parseAdminTextIndex(JSON.stringify({ version: 1, languages: [{ code: "../x", name: "X" }, { code: "fr" }] })),
    ).toEqual([]);
  });

  it("writes a language's file in canonical form", () => {
    const change = adminTextFileChange("fr", french);
    expect(change).toEqual({ path: "content/admin-text/fr.json", content: serializeContent(french) });
    expect(() => adminTextFileChange("../fr", french)).toThrow(/language's code/);
  });

  it("hashes English to tell its versions apart", () => {
    expect(englishHash("Publish")).toMatch(/^[0-9a-f]{8}$/);
    expect(englishHash("Publish")).toBe(englishHash("Publish"));
    expect(englishHash("Publish")).not.toBe(englishHash("Publish."));
  });
});
