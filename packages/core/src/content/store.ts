import type { ContentSource } from "./load.js";
import {
  COMPONENTS_DIR,
  CONTENT_DIR,
  HOOKS_DIR,
  INSTALLED_BLOCKS_DIR,
  INSTALLED_PLUGINS_DIR,
  LIB_DIR,
  MEDIA_DIR,
} from "./paths.js";

/** One change in a save: a file's new text, its new bytes (for uploads such as images), or its removal. */
export type FileChange =
  | { path: string; content: string }
  | { path: string; bytes: Uint8Array }
  | { path: string; delete: true };

export interface WriteOptions {
  /** Describes the change, such as `Update page "About us"`. Becomes the commit message. */
  message: string;
  /** The revision the editor started from. The write fails if the site has changed since. */
  expectedRevision: string;
}

/**
 * Read and write access to a site's editable files. Implemented by the
 * development server's local backend and by each git backend.
 */
export interface ContentStore extends ContentSource {
  /**
   * Identifies the current version of the site's files. Changes whenever any
   * file changes. Reads made afterwards see the site at this revision, so a
   * load that starts with `revision()` is consistent even if someone saves meanwhile.
   */
  revision(): Promise<string>;
  /**
   * Applies every change together, or none of them. Throws `ConflictError` if the
   * site is no longer at `options.expectedRevision`. Returns the new revision.
   */
  write(changes: FileChange[], options: WriteOptions): Promise<{ revision: string }>;
  /** Returns a file's bytes, such as an uploaded image's, or `undefined` if it doesn't exist. */
  readBytes(path: string): Promise<Uint8Array | undefined>;
  /**
   * The paths of files that differ between two revisions. Stores with history
   * implement this, which lets `writeChanges` save over changes to unrelated files.
   */
  changedPaths?(from: string, to: string): Promise<string[]>;
}

/** Thrown when a save would overwrite changes someone else made in the meantime. */
export class ConflictError extends Error {
  override name = "ConflictError";

  constructor(message = "The site changed since it was loaded.") {
    super(message);
  }
}

/**
 * The folders the admin panel reads and writes: content, media, the code of
 * blocks installed from block registries, and the list of installed plugins.
 */
export const EDITABLE_FOLDERS = [
  CONTENT_DIR,
  MEDIA_DIR,
  INSTALLED_BLOCKS_DIR,
  COMPONENTS_DIR,
  LIB_DIR,
  HOOKS_DIR,
  INSTALLED_PLUGINS_DIR,
];

/**
 * Whether the admin panel may read or write a path: only files in
 * `EDITABLE_FOLDERS`, written as plain relative paths.
 */
export function isEditablePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return EDITABLE_FOLDERS.some((root) => path.startsWith(`${root}/`));
}

/**
 * Saves changes, tolerating saves by other people to other files. If the site
 * changed since `expectedRevision` but none of the files being saved did, the
 * save is retried on top of the newer revision. If any of them did, it throws
 * `ConflictError`, because saving would overwrite someone else's work.
 */
export async function writeChanges(
  store: ContentStore,
  changes: FileChange[],
  options: WriteOptions,
): Promise<{ revision: string }> {
  let expected = options.expectedRevision;
  const paths = new Set(changes.map((change) => change.path));

  for (let attempt = 0; ; attempt++) {
    try {
      return await store.write(changes, { ...options, expectedRevision: expected });
    } catch (error) {
      if (!(error instanceof ConflictError) || !store.changedPaths || attempt === 2) throw error;
      const current = await store.revision();
      if (current === expected) throw error;
      // Where the host can't say everything that changed, someone else's change may be to these files.
      const changed = await store.changedPaths(options.expectedRevision, current).catch(() => undefined);
      if (!changed || changed.some((path) => paths.has(path))) throw error;
      expected = current;
    }
  }
}

/** The folders a repository that holds only the site's content has: everything editors change. */
export const CONTENT_FOLDERS = [CONTENT_DIR, MEDIA_DIR];

/** Whether a path is the site's content or media, rather than its code, such as installed blocks. */
export function isContentPath(path: string): boolean {
  return isEditablePath(path) && CONTENT_FOLDERS.some((root) => path.startsWith(`${root}/`));
}

/**
 * Thrown when a save would change the site's code in a repository that holds
 * only its content (`GitBackend.contentOnly`), such as adding a block.
 */
export class CodeChangeError extends Error {
  override name = "CodeChangeError";

  constructor(path: string) {
    super(`${path} is part of the site's code, which is kept in a repository of its own, not the content repository.`);
  }
}

/** Throws `CodeChangeError` for the first change outside `content/` and `public/media/`. */
export function assertContentChanges(changes: FileChange[]): void {
  const code = changes.find((change) => !isContentPath(change.path));
  if (code) throw new CodeChangeError(code.path);
}
