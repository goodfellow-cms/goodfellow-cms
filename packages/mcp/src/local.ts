/**
 * Sites in a folder on this computer, such as a clone of the site's
 * repository: Claude reads and writes its files there, as `goodfellow dev`'s
 * admin panel does, and sees its blocks and takes screenshots through its
 * development server. Changes wait in a draft, kept beside the site's
 * packages, until they're published, which writes them into the folder, for
 * the developer to commit as they would any change.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  type DraftKeeper,
  type FileChange,
  type GitBackend,
  type KeptDraft,
  keptDrafts,
  SITE_DESCRIPTION_PATH,
  SITE_FILE,
} from "@goodfellow-cms/core";
import { localFileStore } from "@goodfellow-cms/core/node";
import { ToolError } from "./content.js";

/** Where a local site's draft is kept: beside its packages, which git leaves out. */
export const LOCAL_DRAFT_FILE = "node_modules/.goodfellow/claude-draft.json";

/** A site in a folder, as `local:` and the folder, with where its development server is if not where it's looked for. */
export interface LocalSite {
  id: string;
  folder: string;
  address?: string;
}

/**
 * Reads a site given as a folder: `local:C:\Sites\parish`, or the folder on its
 * own where it's a full path, with `@` and the development server's address
 * after it where that isn't the usual one. `undefined` where it isn't a folder.
 */
export function parseLocalSite(entry: string): LocalSite | undefined {
  let rest = entry.trim();
  if (rest.startsWith("local:")) rest = rest.slice("local:".length);
  else if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(rest)) return undefined;
  const at = rest.search(/@https?:\/\//);
  const folder = resolve(at === -1 ? rest : rest.slice(0, at));
  const address = at === -1 ? undefined : rest.slice(at + 1).replace(/\/+$/, "");
  return { id: `local:${folder}`, folder, ...(address && { address }) };
}

/** Whether a folder holds a Goodfellow site. */
export function isSiteFolder(folder: string): boolean {
  return existsSync(join(folder, SITE_FILE));
}

/** Where a site's development server answers, by what the folder holds: `next dev`'s port, or `goodfellow dev`'s. */
export function developmentAddresses(site: LocalSite): string[] {
  if (site.address) return [site.address];
  const next = ["next.config.ts", "next.config.mjs", "next.config.js"].some((file) =>
    existsSync(join(site.folder, file)),
  );
  return next ? ["http://localhost:3000", "http://localhost:4321"] : ["http://localhost:4321", "http://localhost:3000"];
}

/** The first of the addresses whose server answers with a site's description. */
export async function servedAt(site: LocalSite, fetcher: typeof fetch = fetch): Promise<string> {
  const addresses = developmentAddresses(site);
  for (const address of addresses) {
    const response = await fetcher(`${address}/${SITE_DESCRIPTION_PATH}`, {
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
    if (response?.ok) return address;
  }
  throw new ToolError(
    `Claude sees a site on this computer through its development server, which isn't running at ${addresses.join(" or ")}. Start it in ${site.folder} (npm run dev), then try again.${site.address ? "" : ` If it runs somewhere else, add @ and its address after the folder in the connector's settings, such as ${site.folder}@http://localhost:4400.`}`,
  );
}

type StoredChange =
  | { path: string; content: string }
  | { path: string; base64: string }
  | { path: string; delete: true };
type StoredOriginal = { content: string } | { base64: string } | { missing: true };

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

function storeChange(change: FileChange): StoredChange {
  if ("bytes" in change) return { path: change.path, base64: toBase64(change.bytes) };
  return change;
}

function readChange(change: StoredChange): FileChange {
  return "base64" in change ? { path: change.path, bytes: fromBase64(change.base64) } : change;
}

/** Keeps a local site's draft in a file, so it lasts between conversations and restarts. */
export function fileKeeper(folder: string): DraftKeeper {
  const file = join(folder, LOCAL_DRAFT_FILE);
  return {
    async load() {
      const text = await readFile(file, "utf8").catch(() => undefined);
      if (!text) return undefined;
      const stored = JSON.parse(text) as Omit<KeptDraft, "changes" | "originals"> & {
        changes: StoredChange[];
        originals: Record<string, StoredOriginal>;
      };
      return {
        ...stored,
        changes: stored.changes.map(readChange),
        originals: Object.fromEntries(
          Object.entries(stored.originals).map(([path, original]) => [
            path,
            "base64" in original ? { bytes: fromBase64(original.base64) } : original,
          ]),
        ),
      };
    },
    async save(draft) {
      if (!draft) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(dirname(file), { recursive: true });
      const stored = {
        ...draft,
        changes: draft.changes.map(storeChange),
        originals: Object.fromEntries(
          Object.entries(draft.originals).map(([path, original]) => [
            path,
            "bytes" in original ? { base64: toBase64(original.bytes) } : original,
          ]),
        ),
      };
      await writeFile(file, `${JSON.stringify(stored)}\n`);
    },
  };
}

function notHere(what: string): never {
  throw new ToolError(`${what} isn't available for a site in a folder on this computer.`);
}

/** A site in a folder as a backend: its files, and one draft at a time, which publishing writes into the folder. */
export function localBackend(folder: string): GitBackend {
  const store = localFileStore(folder);
  return {
    ...store,
    revision: () => store.revision(),
    read: (path) => store.read(path),
    readBytes: (path) => store.readBytes(path),
    list: (dir) => store.list(dir),
    write: (changes, options) => store.write(changes, options),
    user: { login: basename(folder), name: "You" },
    changedPaths: async () => notHere("What changed between versions"),
    deployStatus: async () => ({ state: "unknown" }),
    history: async () => notHere("Version history"),
    readAt: async () => notHere("Version history"),
    filesAt: () => notHere("Version history"),
    drafts: keptDrafts(store, fileKeeper(folder)),
    signOut: () => {},
  };
}
