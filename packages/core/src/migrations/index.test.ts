import { describe, expect, it } from "vitest";
import { CURRENT_VERSION, MigrationError, type MigrationRegistry, migrateContent, migrations } from "./index.js";

const registry: MigrationRegistry = {
  site: [
    { from: 1, up: ({ name, ...rest }) => ({ ...rest, title: name }) },
    { from: 2, up: (file) => ({ ...file, language: "en" }) },
  ],
  menus: [],
  page: [],
  layout: [],
  collection: [],
  entry: [],
  updates: [],
  redirects: [],
  media: [],
  theme: [],
  storage: [],
  permissions: [],
  "admin-text": [],
};

describe("migrateContent", () => {
  it("applies each migration in order up to the current version", () => {
    expect(migrateContent("site", { version: 1, name: "Parish" }, { registry, currentVersion: 3 })).toEqual({
      version: 3,
      title: "Parish",
      language: "en",
    });
  });

  it("returns current files unchanged", () => {
    const file = { version: 3, title: "Parish" };
    expect(migrateContent("site", file, { registry, currentVersion: 3 })).toEqual(file);
  });

  it("refuses files from a newer version of Goodfellow", () => {
    expect(() => migrateContent("site", { version: 4 }, { registry, currentVersion: 3 })).toThrow(/newer version/);
  });

  it("refuses files without a version", () => {
    expect(() => migrateContent("site", {}, { registry, currentVersion: 3 })).toThrow(MigrationError);
    expect(() => migrateContent("site", { version: "1" }, { registry, currentVersion: 3 })).toThrow(MigrationError);
  });

  it("reports a gap in the migration chain", () => {
    expect(() => migrateContent("menus", { version: 1 }, { registry, currentVersion: 2 })).toThrow(/no migration/);
  });

  it("has a complete chain for every kind of file", () => {
    for (const [kind, version] of Object.entries(CURRENT_VERSION)) {
      const steps = migrations[kind as keyof typeof migrations].map((migration) => migration.from).sort();
      expect(steps).toEqual(Array.from({ length: version - 1 }, (_, index) => index + 1));
    }
  });
});
