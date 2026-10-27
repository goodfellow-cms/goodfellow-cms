/**
 * Drafts for backends without branches of their own, such as a full-stack
 * site's server, a demo or the development servers' local files: one draft,
 * kept wherever `DraftKeeper` keeps it (in the admin panel, the browser's own
 * storage), over the live site's files. Other editors don't see it, and it
 * can't be submitted for review, but it publishes in one save like a draft on
 * a branch (`branchDrafts()`), and fails the same way where someone else has
 * changed one of its files since it started: from the revision it started at,
 * where the live site can list what changed between revisions, and otherwise
 * by keeping each file as it was when the draft first changed it.
 */
import { MEDIA_DIR } from "./content/paths.js";
import { ConflictError, type ContentStore, type FileChange, writeChanges } from "./content/store.js";
import { type Draft, DraftError, isDraftName, type SiteDrafts } from "./drafts.js";

/** What a file was on the live site before a draft changed it: its text, its bytes, or nothing. */
export type KeptOriginal = { content: string } | { bytes: Uint8Array } | { missing: true };

/** A draft as it's kept: its changes, one for each file, and what each file was before. */
export interface KeptDraft {
  name: string;
  /** Counts the draft's saves, for its revisions. */
  version: number;
  /** The live site's revision the draft started from. */
  base: string;
  changes: FileChange[];
  /** Each changed file as it was on the live site when the draft first changed it, by path. */
  originals: Record<string, KeptOriginal>;
}

/** Keeps the one draft, such as in the browser's storage. */
export interface DraftKeeper {
  load(): Promise<KeptDraft | undefined>;
  save(draft: KeptDraft | undefined): Promise<void>;
}

/** A copy of a draft, as storage would give back, so changing one doesn't change the other. */
function copyDraft(draft: KeptDraft): KeptDraft {
  const copy = <T extends object>(value: T): T =>
    ("bytes" in value && value.bytes instanceof Uint8Array
      ? { ...value, bytes: value.bytes.slice() }
      : { ...value }) as T;
  return {
    ...draft,
    changes: draft.changes.map(copy),
    originals: Object.fromEntries(Object.entries(draft.originals).map(([path, original]) => [path, copy(original)])),
  };
}

/** A draft kept in memory, for tests and for keepers that can't store anything. */
export function memoryKeeper(): DraftKeeper {
  let kept: KeptDraft | undefined;
  return {
    load: async () => kept && copyDraft(kept),
    save: async (draft) => {
      kept = draft && copyDraft(draft);
    },
  };
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isMedia(path: string): boolean {
  return path.startsWith(`${MEDIA_DIR}/`);
}

/** A file as it is on the live site now. */
async function original(live: ContentStore, path: string): Promise<KeptOriginal> {
  if (isMedia(path)) {
    const bytes = await live.readBytes(path);
    return bytes ? { bytes } : { missing: true };
  }
  const content = await live.read(path);
  return content === undefined ? { missing: true } : { content };
}

function sameOriginal(a: KeptOriginal, b: KeptOriginal): boolean {
  if ("missing" in a || "missing" in b) return "missing" in a && "missing" in b;
  if ("content" in a || "content" in b) return "content" in a && "content" in b && a.content === b.content;
  return a.bytes.length === b.bytes.length && a.bytes.every((byte, index) => byte === b.bytes[index]);
}

/** Drafts kept by `keeper`, over `live`, the live site's files, which they publish to. */
export function keptDrafts(live: ContentStore, keeper: DraftKeeper): SiteDrafts {
  async function current(name: string): Promise<KeptDraft> {
    const kept = await keeper.load();
    if (!kept || kept.name !== name) throw new DraftError("not-found", `There's no draft ${name}.`);
    return kept;
  }

  function draft(name: string): Draft {
    const changeFor = async (path: string) => (await current(name)).changes.find((change) => change.path === path);
    const store: ContentStore = {
      async revision() {
        const kept = await current(name);
        return `draft:${kept.name}:${kept.version}`;
      },
      async read(path) {
        const change = await changeFor(path);
        if (!change) return live.read(path);
        if ("content" in change) return change.content;
        if ("bytes" in change) return textDecoder.decode(change.bytes);
        return undefined;
      },
      async readBytes(path) {
        const change = await changeFor(path);
        if (!change) return live.readBytes(path);
        if ("bytes" in change) return change.bytes;
        if ("content" in change) return textEncoder.encode(change.content);
        return undefined;
      },
      async list(dir) {
        const { changes } = await current(name);
        const files = new Set(await live.list(dir));
        for (const change of changes) {
          if (!change.path.startsWith(`${dir}/`)) continue;
          if ("delete" in change) files.delete(change.path);
          else files.add(change.path);
        }
        return [...files].sort();
      },
      async write(changes, options) {
        const kept = await current(name);
        if (options.expectedRevision !== `draft:${kept.name}:${kept.version}`) throw new ConflictError();
        const byPath = new Map(kept.changes.map((change) => [change.path, change]));
        const originals = { ...kept.originals };
        for (const change of changes) {
          byPath.set(change.path, change);
          originals[change.path] ??= await original(live, change.path);
        }
        const next = { ...kept, version: kept.version + 1, changes: [...byPath.values()], originals };
        await keeper.save(next);
        return { revision: `draft:${next.name}:${next.version}` };
      },
    };

    return {
      name,
      store,
      changes: async () => (await current(name)).changes,
      paths: async () => (await current(name)).changes.map((change) => change.path),
      async publish(message) {
        const kept = await current(name);
        const revision = await live.revision();
        // Someone else changed a file the draft changes since it did: as a publish over their change would.
        for (const [path, before] of Object.entries(kept.originals)) {
          if (!sameOriginal(before, await original(live, path))) throw new ConflictError();
        }
        // Where the live site says what changed since the draft started, that catches changes made before its first save too.
        const expectedRevision = live.changedPaths ? kept.base : revision;
        const result =
          kept.changes.length > 0
            ? await writeChanges(live, kept.changes, { message, expectedRevision })
            : { revision };
        await keeper.save(undefined);
        return result;
      },
      async submitForReview() {
        throw new DraftError("no-reviews", "Drafts kept in this browser can't be submitted for review.");
      },
      async discard() {
        await keeper.save(undefined);
      },
    };
  }

  return {
    async create(name, options) {
      if (!isDraftName(name)) throw new DraftError("not-found", `"${name}" isn't a draft's name.`);
      if (await keeper.load()) throw new DraftError("exists", "There's already a draft.");
      const base = options?.from ?? (await live.revision());
      await keeper.save({ name, version: 0, base, changes: [], originals: {} });
      return draft(name);
    },
    async open(name) {
      await current(name);
      return draft(name);
    },
    async list() {
      const kept = await keeper.load();
      return kept ? [kept.name] : [];
    },
    // Drafts kept in a browser can't be submitted for review, so none is waiting.
    async reviews() {
      return [];
    },
  };
}
