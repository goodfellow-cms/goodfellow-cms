import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ConflictError, type ContentStore, EDITABLE_FOLDERS, type FileChange, isEditablePath } from "./index.js";
import { fileSystemSource } from "./node-fs-source.js";

export class InvalidPathError extends Error {
  override name = "InvalidPathError";
}

function assertEditable(path: string): void {
  if (!isEditablePath(path)) {
    throw new InvalidPathError(
      `${path} can't be edited from the admin panel. Only files in content/ and public/media/ can.`,
    );
  }
}

/** Where files are written before they're moved into place: inside the site, but outside what anything watches. */
const WRITING_DIR = "node_modules/.goodfellow/writing";

/**
 * Writes a file whole: to a temporary file, then moved into place, so the
 * development servers' watchers, and Tailwind scanning the site for class
 * names, see the old file or the new one, never part of one. Tailwind keeps
 * every class name it has seen until it restarts, so one half-written file
 * would break the site's CSS until then.
 */
async function writeWhole(root: string, file: string, data: string | Uint8Array): Promise<void> {
  const dir = join(root, WRITING_DIR);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, randomUUID());
  await writeFile(temporary, data);
  try {
    await rename(temporary, file);
  } catch {
    // Another drive, such as a linked content repository: written in place.
    await rm(temporary, { force: true });
    await writeFile(file, data);
  }
}

/**
 * The development server's local backend: a `ContentStore` over the site's
 * files on disk. Revisions are a hash of every editable file, so any change on
 * disk (from the admin panel or a text editor) produces a new revision.
 * Writes are serialized so two saves can't interleave.
 */
export function localFileStore(root: string): ContentStore {
  const source = fileSystemSource(root);
  let queue: Promise<unknown> = Promise.resolve();

  async function revision(): Promise<string> {
    const files = (await Promise.all(EDITABLE_FOLDERS.map((folder) => source.list(folder)))).flat().sort();
    const hash = createHash("sha256");
    for (const file of files) {
      const content = await readFile(join(root, file));
      hash.update(file).update("\0").update(createHash("sha256").update(content).digest()).update("\0");
    }
    return hash.digest("hex").slice(0, 16);
  }

  async function applyChanges(changes: FileChange[], expectedRevision: string): Promise<{ revision: string }> {
    for (const change of changes) assertEditable(change.path);
    if ((await revision()) !== expectedRevision) throw new ConflictError();

    for (const change of changes) {
      const file = join(root, change.path);
      if ("delete" in change) {
        await rm(file, { force: true });
      } else {
        await mkdir(dirname(file), { recursive: true });
        await writeWhole(root, file, "bytes" in change ? change.bytes : change.content);
      }
    }
    return { revision: await revision() };
  }

  return {
    read: async (path) => {
      assertEditable(path);
      return source.read(path);
    },
    readBytes: async (path) => {
      assertEditable(path);
      try {
        return new Uint8Array(await readFile(join(root, path)));
      } catch {
        return undefined;
      }
    },
    list: async (dir) => {
      if (!isEditablePath(`${dir}/x`)) throw new InvalidPathError(`${dir} can't be listed from the admin panel.`);
      return source.list(dir);
    },
    revision,
    write: (changes, { expectedRevision }) => {
      const result = queue.then(() => applyChanges(changes, expectedRevision));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
