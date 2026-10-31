import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { SITE_FILE } from "./content/paths.js";
import type { ContentSource } from "./index.js";
import { siteCopyFrom, trailingSlashFrom, withSiteCopy, withTrailingSlash } from "./site-copy.js";

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export interface FileSystemSourceOptions {
  /**
   * The environment of a build of a copy of the site, such as a staging
   * site's (`siteCopyFrom()`): its address and search engine setting take the
   * place of Site settings'. With it, how pages' addresses end
   * (`GOODFELLOW_TRAILING_SLASH`, `trailingSlashFrom()`) too. Only for building
   * and showing pages: what the admin panel reads and saves is the files as
   * they are.
   */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Reads a site's files from disk. Paths are relative to the site root and always use `/`. */
export function fileSystemSource(root: string, options: FileSystemSourceOptions = {}): ContentSource {
  const copy = options.env && siteCopyFrom(options.env);
  const trailingSlash = options.env && trailingSlashFrom(options.env);
  return {
    async read(path) {
      try {
        const text = await readFile(join(root, path), "utf8");
        if (path !== SITE_FILE) return text;
        return withTrailingSlash(copy ? withSiteCopy(text, copy) : text, trailingSlash);
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async list(dir) {
      try {
        const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
          .sort();
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
  };
}

/**
 * The site as this build of it shows it: its files, with the address and
 * search engine setting of the copy being built, such as a staging site,
 * from `GOODFELLOW_SITE_URL` and `GOODFELLOW_NO_INDEX`, and how its pages'
 * addresses end, from `GOODFELLOW_TRAILING_SLASH`.
 */
export function builtSiteSource(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ContentSource {
  return fileSystemSource(root, { env });
}
