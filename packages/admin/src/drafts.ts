import { type DraftKeeper, type KeptDraft, memoryKeeper } from "@goodfellow-cms/core";

const DATABASE = "goodfellow-drafts";
const TABLE = "drafts";
const CURRENT_KEY = "goodfellow.draft";

function request<T>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

/**
 * Keeps the draft of a site whose backend has no drafts of its own (a
 * full-stack site's server, a demo, the development servers) in the browser's
 * IndexedDB, which can hold uploads too large for local storage, so it stays
 * when the tab closes. `key` tells apart sites served from the same address.
 * Where the browser keeps nothing, such as in some private windows, it's kept
 * only while the page is open.
 */
export function browserDraftKeeper(key: string): DraftKeeper {
  if (typeof indexedDB === "undefined") return memoryKeeper();
  let database: Promise<IDBDatabase> | undefined;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DATABASE, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore(TABLE);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return database;
  };
  const table = async (mode: IDBTransactionMode) => (await open()).transaction(TABLE, mode).objectStore(TABLE);
  return {
    load: async () => (await request((await table("readonly")).get(key))) as KeptDraft | undefined,
    save: async (draft) => {
      const store = await table("readwrite");
      if (draft) await request(store.put(draft, key));
      else await request(store.delete(key));
    },
  };
}

/** The draft this browser was working in on a site, so it opens again when the admin panel does. */
export function rememberedDraft(site: string): string | undefined {
  try {
    return localStorage.getItem(`${CURRENT_KEY}:${site}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberDraft(site: string, name: string | undefined): void {
  try {
    if (name) localStorage.setItem(`${CURRENT_KEY}:${site}`, name);
    else localStorage.removeItem(`${CURRENT_KEY}:${site}`);
  } catch {
    // Without storage, the draft is still listed, and can be opened again.
  }
}

/** When a draft started, from its name (`newDraftName()`), as the computer writes dates, or its name where that doesn't say. */
export function draftStarted(name: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-/.exec(name);
  if (!match) return name;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime())
    ? name
    : date.toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" });
}
