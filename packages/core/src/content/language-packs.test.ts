import { describe, expect, it } from "vitest";
import { type AdminTextFile, englishHash } from "./admin-text.js";
import { fromLanguagePack, type LanguagePack, planLanguagePack } from "./language-packs.js";

/** A plan's file, which these tests always expect. */
function fileOf(plan: { file: AdminTextFile | undefined }): AdminTextFile {
  if (!plan.file) throw new Error("No file was planned.");
  return plan.file;
}

function pack(release: string, strings: Record<string, string>, code = "fr"): LanguagePack {
  return {
    name: "goodfellow-language-fr",
    release,
    goodfellow: ">=0.9.0",
    manifest: {
      version: 1,
      code,
      name: "Français",
      strings: Object.fromEntries(Object.entries(strings).map(([key, text]) => [key, { text, reviewed: true }])),
      puck: {},
      labels: { Heading: { text: "Titre" } },
    },
  };
}

describe("installing a language pack", () => {
  it("writes its strings, each marked as the pack's, with a record of the release", () => {
    const plan = planLanguagePack("fr", undefined, pack("1.0.0", { "publish.button": "Publier" }));
    expect(plan.file).toEqual({
      version: 1,
      name: "Français",
      strings: { "publish.button": { text: "Publier", reviewed: true, pack: englishHash("Publier") } },
      puck: {},
      labels: { Heading: { text: "Titre", pack: englishHash("Titre") } },
      pack: { name: "goodfellow-language-fr", release: "1.0.0", goodfellow: ">=0.9.0" },
    });
    expect(plan.changes[0]?.path).toBe("content/admin-text/fr.json");
    expect(plan.written).toBe(2);
  });

  it("keeps the owner's own words unless asked to replace them", () => {
    const own: AdminTextFile = {
      version: 1,
      name: "Français (Québec)",
      strings: {
        "publish.button": { text: "Mettre en ligne", reviewed: true },
        "nav.pages": { text: "Pages", source: "abcd1234" },
      },
      puck: {},
      labels: {},
    };
    const next = pack("1.0.0", { "publish.button": "Publier", "nav.pages": "Pages" });
    const plan = planLanguagePack("fr", own, next);
    expect(plan.file?.name).toBe("Français (Québec)");
    expect(plan.file?.strings["publish.button"]?.text).toBe("Mettre en ligne");
    expect(plan.kept).toEqual([{ table: "strings", key: "publish.button" }]);
    // The same words as the pack's become the pack's, so later releases may change them.
    const pages = fileOf(plan).strings["nav.pages"];
    expect(pages && fromLanguagePack(pages)).toBe(true);
    expect(plan.file?.strings["nav.pages"]?.source).toBe("abcd1234");

    const replacing = planLanguagePack("fr", own, next, { replaceOwn: true });
    expect(replacing.file?.strings["publish.button"]?.text).toBe("Publier");
    expect(replacing.replaced).toEqual([{ table: "strings", key: "publish.button" }]);
  });

  it("updates only what nobody has changed, and takes out what the new release dropped", () => {
    const first = fileOf(planLanguagePack("fr", undefined, pack("1.0.0", { a: "Un", b: "Deux", c: "Trois" })));
    // An owner changes one, and reads another without changing it.
    first.strings.b = { ...first.strings.b, text: "Deux !" };
    first.strings.c = { ...first.strings.c, text: "Trois", reviewed: true };
    const plan = planLanguagePack("fr", first, pack("1.1.0", { a: "Une", b: "Deuxième" }));
    expect(plan.file?.strings.a?.text).toBe("Une");
    expect(plan.file?.strings.b?.text).toBe("Deux !");
    expect(plan.kept).toEqual([{ table: "strings", key: "b" }]);
    expect(plan.file?.strings).not.toHaveProperty("c");
    expect(plan.removed).toBe(1);
    expect(plan.file?.pack?.release).toBe("1.1.0");
  });

  it("removes a pack, keeping the owner's words, and deletes a file left empty", () => {
    const installed = fileOf(planLanguagePack("fr", undefined, pack("1.0.0", { a: "Un", b: "Deux" })));
    installed.strings.b = { text: "Deux !" };
    const removed = planLanguagePack("fr", installed, undefined);
    expect(removed.file?.strings).toEqual({ b: { text: "Deux !" } });
    expect(removed.file).not.toHaveProperty("pack");
    const untouched = planLanguagePack(
      "fr",
      planLanguagePack("fr", undefined, pack("1.0.0", { a: "Un" })).file,
      undefined,
    );
    expect(untouched.file).toBeUndefined();
    expect(untouched.changes).toEqual([{ path: "content/admin-text/fr.json", delete: true }]);
  });

  it("refuses a pack for another language", () => {
    expect(() => planLanguagePack("de", undefined, pack("1.0.0", {}))).toThrow(/not "de"/);
  });
});
