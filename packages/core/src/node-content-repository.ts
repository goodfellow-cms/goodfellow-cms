import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, rmdir, symlink, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { CONTENT_DIR, CONTENT_FOLDERS, CONTENT_REPOSITORY_DIR, MEDIA_DIR, SITE_FILE } from "./index.js";

/** Thrown when a content repository can't be put in place, with what to do about it. */
export class ContentRepositoryError extends Error {
  override name = "ContentRepositoryError";
}

export interface ContentRepositoryOptions {
  /** The content repository's folder, relative to the site's folder. Defaults to `content-repository`. */
  from?: string;
  /** Copies its files instead of linking to them, as builds do. */
  copy?: boolean;
}

/** Removes a link to a folder, which Windows makes as a junction that `unlink()` can't always remove. */
async function removeLink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EISDIR") throw error;
    await rmdir(path);
  }
}

/** Clears the way for a link or copy at `target`: an old link or an empty folder goes, anything else stays and throws. */
async function clear(target: string, name: string): Promise<void> {
  const stats = await lstat(target).catch(() => undefined);
  if (!stats) return;
  if (stats.isSymbolicLink()) return removeLink(target);
  if (stats.isDirectory() && (await readdir(target)).length === 0) return rmdir(target);
  throw new ContentRepositoryError(
    `${name} already has files of its own. Move them into the content repository, or remove them, first.`,
  );
}

/**
 * Puts a content repository's `content/` and `public/media/` where the site's
 * code expects them, for a site whose content is kept in a repository of its
 * own: as links on a developer's computer, so the dev servers read and save the
 * content repository's own files, or as copies in builds. Returns the content
 * repository's folder.
 */
export async function useContentRepository(root: string, options: ContentRepositoryOptions = {}): Promise<string> {
  const site = resolve(root);
  const from = resolve(site, options.from ?? CONTENT_REPOSITORY_DIR);
  const shown = relative(process.cwd(), from) || ".";
  if (from === site) {
    throw new ContentRepositoryError("The content repository has to be a folder of its own, not the site's folder.");
  }
  if (!existsSync(join(from, SITE_FILE))) {
    throw new ContentRepositoryError(
      existsSync(from)
        ? `${shown} isn't a content repository: it has no ${SITE_FILE}.`
        : `There's no content repository at ${shown}. Clone it there first.`,
    );
  }

  for (const folder of CONTENT_FOLDERS) {
    const source = join(from, folder);
    const target = join(site, folder);
    // A content repository with no media yet gets the folder, so uploads have somewhere to go.
    if (folder === MEDIA_DIR) await mkdir(source, { recursive: true });
    await clear(target, `${folder}/`);
    await mkdir(dirname(target), { recursive: true });
    if (options.copy) await cp(source, target, { recursive: true });
    // Relative, so the site's folder can move. Windows makes a junction, which needs no special permission but
    // holds the whole path, so it's made again after moving the folder.
    else await symlink(relative(dirname(target), source), target, "junction");
  }
  return from;
}

/**
 * What's wrong when a site's content is in its content repository's folder but
 * hasn't been put in place yet, or `undefined`, for the dev servers and builds to say before they start.
 */
export function contentRepositoryProblem(root: string): string | undefined {
  if (existsSync(join(root, CONTENT_DIR)) || !existsSync(join(root, CONTENT_REPOSITORY_DIR))) return undefined;
  return `This site's content is in ${CONTENT_REPOSITORY_DIR}/, but content/ doesn't link to it yet. Run: npx goodfellow content link (or npx goodfellow-next content link for a Next.js site)`;
}
