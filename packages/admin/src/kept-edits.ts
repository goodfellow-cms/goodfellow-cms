/**
 * What an editor has changed but not published, kept in this browser as they
 * type, so a closed tab, a crash or a sign-in that ran out doesn't lose it.
 * Each is kept by site, by what's edited and by draft, with what was
 * published when the changes started, so the editor can tell when someone
 * else has published since. They're removed once published or undone, after
 * `KEPT_EDIT_DAYS`, and on signing out, so the next person on this computer
 * doesn't find them.
 */
import type { Data } from "@puckeditor/core";

const DATABASE = "goodfellow-edits";
const TABLE = "edits";

/** How long unpublished changes are kept. */
export const KEPT_EDIT_DAYS = 30;
const KEPT_EDIT_MS = KEPT_EDIT_DAYS * 24 * 60 * 60 * 1000;

/** Unpublished changes to one page, header, footer, template or item. */
export interface KeptEdit {
  /** What's edited, as the editor had it. */
  data: Data;
  /** What was published when the changes started, as `serializeContent()` writes it. */
  published: string;
  /** When they were kept, in milliseconds since 1970. */
  savedAt: number;
}

/** What's edited, as `PuckEditor` is given it. */
export interface EditTarget {
  kind: string;
  path: string;
  collection?: string;
  entry?: string;
  language?: string;
}

/** Where one thing's changes are kept: the site, what's edited, and the draft they go into, if any. */
export function keptEditKey(site: string, target: EditTarget, draft?: string): string {
  return JSON.stringify([
    site,
    draft ?? "",
    target.kind,
    target.kind === "template" ? "" : target.path,
    target.collection ?? "",
    target.entry ?? "",
    target.language ?? "",
  ]);
}

/** A kept value, if it's one this module wrote and isn't past `KEPT_EDIT_DAYS`. */
export function readKeptEdit(value: unknown, now: number): KeptEdit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { data, published, savedAt } = value as Partial<KeptEdit>;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  if (typeof published !== "string" || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return undefined;
  if (savedAt > now || now - savedAt > KEPT_EDIT_MS) return undefined;
  return { data, published, savedAt };
}

export interface EditKeeper {
  load(key: string): Promise<KeptEdit | undefined>;
  save(key: string, edit: KeptEdit): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes everything kept, for every site. */
  clear(): Promise<void>;
}

/** Keeps changes only while the page is open, where the browser keeps nothing. */
export function memoryEditKeeper(now: () => number = Date.now): EditKeeper {
  const kept = new Map<string, unknown>();
  return {
    load: async (key) => {
      const edit = readKeptEdit(kept.get(key), now());
      if (!edit) kept.delete(key);
      return edit;
    },
    save: async (key, edit) => {
      kept.set(key, structuredClone(edit));
    },
    remove: async (key) => {
      kept.delete(key);
    },
    clear: async () => {
      kept.clear();
    },
  };
}

function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

/**
 * Keeps changes in the browser's IndexedDB, so they stay when the tab closes.
 * The first time it's opened, it removes changes older than `KEPT_EDIT_DAYS`.
 */
function browserEditKeeper(): EditKeeper {
  if (typeof indexedDB === "undefined") return memoryEditKeeper();
  let database: Promise<IDBDatabase> | undefined;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DATABASE, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore(TABLE);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    }).then(async (opened) => {
      await removeExpired(opened).catch(() => undefined);
      return opened;
    });
    return database;
  };
  const table = async (mode: IDBTransactionMode) => (await open()).transaction(TABLE, mode).objectStore(TABLE);
  return {
    load: async (key) => {
      const edit = readKeptEdit(await request((await table("readonly")).get(key)), Date.now());
      if (!edit) await request((await table("readwrite")).delete(key));
      return edit;
    },
    save: async (key, edit) => {
      await request((await table("readwrite")).put(edit, key));
    },
    remove: async (key) => {
      await request((await table("readwrite")).delete(key));
    },
    clear: async () => {
      await request((await table("readwrite")).clear());
    },
  };
}

function removeExpired(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const transaction = database.transaction(TABLE, "readwrite");
    const cursor = transaction.objectStore(TABLE).openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return;
      if (!readKeptEdit(at.value, now)) at.delete();
      at.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

let keeper: EditKeeper | undefined;

/** This browser's kept changes. */
export function editKeeper(): EditKeeper {
  keeper ??= browserEditKeeper();
  return keeper;
}

/** Forgets every change kept in this browser, as signing out does. Never throws. */
export async function forgetKeptEdits(): Promise<void> {
  await editKeeper()
    .clear()
    .catch(() => undefined);
}
