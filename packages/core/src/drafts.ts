/**
 * Drafts: changes saved on a branch of their own instead of the live site,
 * until they're published or submitted for review. Tools that edit a site in
 * several steps, such as the Claude connector, keep their work in one, so a
 * server that remembers nothing between calls can still show changes before
 * they're live. Each backend supplies the branches (`DraftHost`) and this
 * module does the rest, the same way for every host.
 */
import { MEDIA_DIR } from "./content/paths.js";
import { type ContentStore, type FileChange, writeChanges } from "./content/store.js";

/** Draft branches are named this, then the draft's name. */
export const DRAFT_BRANCH_PREFIX = "goodfellow-draft-";

const DRAFT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Whether a name can be a draft's. */
export function isDraftName(name: string): boolean {
  return DRAFT_NAME.test(name);
}

export type DraftProblem =
  /** There's no draft by that name, or it's been published or discarded. */
  | "not-found"
  /** There's already a draft by that name. */
  | "exists"
  /** The host or this sign-in can't open pull or merge requests. */
  | "no-reviews";

export class DraftError extends Error {
  override name = "DraftError";
  readonly problem: DraftProblem;

  constructor(problem: DraftProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

/** What a backend does with branches for drafts. */
export interface DraftHost {
  /** The branch the live site is built from. */
  readonly liveBranch: string;
  /** Reads and writes one branch: writes are commits on it. */
  branchStore(branch: string): ContentStore & { changedPaths(from: string, to: string): Promise<string[]> };
  /** Makes a branch at a revision. Throws `DraftError` (`exists`) if it's there already. */
  createBranch(branch: string, revision: string): Promise<void>;
  /** Removes a branch. Nothing happens if it's already gone. */
  deleteBranch(branch: string): Promise<void>;
  /** The newest commit that the live branch and `branch` share. Throws `DraftError` (`not-found`) without the branch. */
  mergeBase(branch: string): Promise<string>;
  /** Opens a pull or merge request from `branch` to the live branch, or gives the open one. */
  openReview(options: { branch: string; title: string; description: string }): Promise<{ url: string }>;
}

/** One draft. */
export interface Draft {
  readonly name: string;
  /** The draft's files: what's live, with the draft's changes. Writes save to the draft. */
  readonly store: ContentStore;
  /** The draft's changes since it started: each file it changed, as it is in the draft. */
  changes(): Promise<FileChange[]>;
  /**
   * Publishes the draft's changes to the live site in one save, then removes
   * the draft. Throws `ConflictError` if someone changed the same files on the
   * live site meanwhile; the draft is kept.
   */
  publish(message: string): Promise<{ revision: string }>;
  /** Asks for the draft to be reviewed before it's published: a pull or merge request. */
  submitForReview(options: { title: string; description?: string }): Promise<{ url: string }>;
  /** Removes the draft and its changes. */
  discard(): Promise<void>;
}

export interface SiteDrafts {
  /** Starts a draft from the live site as it is now. */
  create(name: string): Promise<Draft>;
  /** A draft started earlier. Throws `DraftError` (`not-found`) if there's none by that name. */
  open(name: string): Promise<Draft>;
}

/** A name for a new draft: the date, then random letters, such as `20261014-k3x9qa`. */
export function newDraftName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => letters[byte % letters.length]);
  return `${date}-${random.join("")}`;
}

function checkName(name: string): string {
  if (!isDraftName(name)) throw new DraftError("not-found", `"${name}" isn't a draft's name.`);
  return `${DRAFT_BRANCH_PREFIX}${name}`;
}

/** Drafts on a backend's branches, publishing to `live`, the backend for the live branch. */
export function branchDrafts(live: ContentStore, host: DraftHost): SiteDrafts {
  function draft(name: string, branch: string): Draft {
    const store = host.branchStore(branch);

    async function changes(): Promise<FileChange[]> {
      const base = await host.mergeBase(branch);
      const head = await store.revision();
      const paths = await store.changedPaths(base, head);
      const result: FileChange[] = [];
      for (const path of paths) {
        if (path.startsWith(`${MEDIA_DIR}/`)) {
          const bytes = await store.readBytes(path);
          result.push(bytes ? { path, bytes } : { path, delete: true });
        } else {
          const content = await store.read(path);
          result.push(content === undefined ? { path, delete: true } : { path, content });
        }
      }
      return result;
    }

    return {
      name,
      store,
      changes,
      async publish(message) {
        const base = await host.mergeBase(branch);
        const changed = await changes();
        const result =
          changed.length > 0
            ? await writeChanges(live, changed, { message, expectedRevision: base })
            : { revision: await live.revision() };
        await host.deleteBranch(branch);
        return result;
      },
      async submitForReview({ title, description = "" }) {
        return host.openReview({ branch, title, description });
      },
      async discard() {
        await host.deleteBranch(branch);
      },
    };
  }

  return {
    async create(name) {
      const branch = checkName(name);
      await host.createBranch(branch, await live.revision());
      return draft(name, branch);
    },
    async open(name) {
      const branch = checkName(name);
      // Throws if there's no such branch.
      await host.mergeBase(branch);
      return draft(name, branch);
    },
  };
}
