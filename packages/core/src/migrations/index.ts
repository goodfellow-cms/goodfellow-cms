/** The kinds of content file, each with its own version number. */
export type ContentKind =
  | "site"
  | "menus"
  | "page"
  | "layout"
  | "collection"
  | "entry"
  | "updates"
  | "redirects"
  | "media"
  | "theme"
  | "storage"
  | "permissions";

/** The version this release of Goodfellow writes for each kind of file. */
export const CURRENT_VERSION: Record<ContentKind, number> = {
  site: 1,
  menus: 1,
  page: 1,
  layout: 1,
  collection: 1,
  entry: 1,
  updates: 1,
  redirects: 1,
  media: 1,
  theme: 1,
  storage: 1,
  permissions: 1,
};

/** Upgrades a file from version `from` to `from + 1`. */
export interface Migration {
  from: number;
  up(file: Record<string, unknown>): Record<string, unknown>;
}

export type MigrationRegistry = Record<ContentKind, Migration[]>;

/** Every migration ever shipped. Add new ones here; never edit or remove old ones. */
export const migrations: MigrationRegistry = {
  site: [],
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
};

export class MigrationError extends Error {
  override name = "MigrationError";
}

/**
 * Brings a parsed content file up to the current version by applying each
 * migration in turn. Files already at the current version are returned unchanged.
 */
export function migrateContent(
  kind: ContentKind,
  file: Record<string, unknown>,
  options: { registry?: MigrationRegistry; currentVersion?: number } = {},
): Record<string, unknown> {
  const registry = options.registry ?? migrations;
  const target = options.currentVersion ?? CURRENT_VERSION[kind];
  const version = file.version;

  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new MigrationError('is missing its "version" number.');
  }
  if (version > target) {
    throw new MigrationError(
      `was saved by a newer version of Goodfellow (file version ${version}, this version reads up to ${target}). Update Goodfellow to use it.`,
    );
  }

  let current = file;
  for (let from = version; from < target; from++) {
    const migration = registry[kind].find((candidate) => candidate.from === from);
    if (!migration) {
      throw new MigrationError(`can't be upgraded from version ${from}: no migration exists.`);
    }
    current = { ...migration.up(current), version: from + 1 };
  }
  return current;
}
