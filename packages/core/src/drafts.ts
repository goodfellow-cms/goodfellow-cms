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
  /**
   * Opens a pull or merge request from `branch` to the live branch, or gives
   * the open one, asking `reviewers` (sign-in names on the host) to review it
   * where the host can find them; someone it can't find is left out.
   */
  openReview(options: {
    branch: string;
    title: string;
    description: string;
    reviewers?: readonly string[];
  }): Promise<{ url: string }>;
  /** The open pull or merge requests from branches whose names start with `prefix`. */
  listReviews(prefix: string): Promise<Array<{ branch: string; url: string; title: string }>>;
  /** Closes the open pull or merge request from `branch`, if there is one, without merging it. */
  closeReview(branch: string): Promise<void>;
  /** The branches whose names start with `prefix`. */
  listBranches(prefix: string): Promise<string[]>;
}

/** One draft. */
export interface Draft {
  readonly name: string;
  /** The draft's files: what's live, with the draft's changes. Writes save to the draft. */
  readonly store: ContentStore;
  /** The draft's changes since it started: each file it changed, as it is in the draft. */
  changes(): Promise<FileChange[]>;
  /** The paths of the files it changed, without reading them. */
  paths(): Promise<string[]>;
  /**
   * Publishes the draft's changes to the live site in one save, then removes
   * the draft. Throws `ConflictError` if someone changed the same files on the
   * live site meanwhile; the draft is kept.
   */
  publish(message: string): Promise<{ revision: string }>;
  /**
   * Asks for the draft to be reviewed before it's published: a pull or merge
   * request, which asks `reviewers` (sign-in names on the host) to review it.
   */
  submitForReview(options: {
    title: string;
    description?: string;
    reviewers?: readonly string[];
  }): Promise<{ url: string }>;
  /** Removes the draft and its changes. */
  discard(): Promise<void>;
}

export interface SiteDrafts {
  /**
   * Starts a draft from the live site as it is now, or as it was at `from`,
   * such as the revision an editor loaded, so publishing it fails where
   * someone else has changed the same files since.
   */
  create(name: string, options?: { from?: string }): Promise<Draft>;
  /** A draft started earlier. Throws `DraftError` (`not-found`) if there's none by that name. */
  open(name: string): Promise<Draft>;
  /**
   * The drafts there are, by name, newest first where names start with their
   * date (`newDraftName()`), whoever started them: in the admin panel or from Claude.
   */
  list(): Promise<string[]>;
  /** The drafts submitted for review that are still waiting, newest first, with where they're reviewed. */
  reviews(): Promise<DraftReview[]>;
}

/** A draft waiting for review. */
export interface DraftReview {
  /** The draft's name. */
  name: string;
  /** The pull or merge request, on the host. */
  url: string;
  title: string;
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
  /** Closes a draft's review once it's published or thrown away: GitLab keeps it open when the branch goes. */
  async function closeReview(branch: string): Promise<void> {
    try {
      await host.closeReview(branch);
    } catch {
      // The draft is published or gone either way; a review left open says so on the host.
    }
  }

  function draft(name: string, branch: string): Draft {
    const store = host.branchStore(branch);

    async function paths(): Promise<string[]> {
      const base = await host.mergeBase(branch);
      return store.changedPaths(base, await store.revision());
    }

    async function changes(): Promise<FileChange[]> {
      const result: FileChange[] = [];
      for (const path of await paths()) {
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
      paths,
      async publish(message) {
        const base = await host.mergeBase(branch);
        const changed = await changes();
        const result =
          changed.length > 0
            ? await writeChanges(live, changed, { message, expectedRevision: base })
            : { revision: await live.revision() };
        await closeReview(branch);
        await host.deleteBranch(branch);
        return result;
      },
      async submitForReview({ title, description = "", reviewers }) {
        return host.openReview({ branch, title, description, ...(reviewers?.length && { reviewers }) });
      },
      async discard() {
        await closeReview(branch);
        await host.deleteBranch(branch);
      },
    };
  }

  return {
    async create(name, options) {
      const branch = checkName(name);
      await host.createBranch(branch, options?.from ?? (await live.revision()));
      return draft(name, branch);
    },
    async open(name) {
      const branch = checkName(name);
      // Throws if there's no such branch.
      await host.mergeBase(branch);
      return draft(name, branch);
    },
    async list() {
      const branches = await host.listBranches(DRAFT_BRANCH_PREFIX);
      return branches
        .map((branch) => branch.slice(DRAFT_BRANCH_PREFIX.length))
        .filter(isDraftName)
        .sort()
        .reverse();
    },
    async reviews() {
      const reviews = await host.listReviews(DRAFT_BRANCH_PREFIX);
      return reviews
        .map((review) => ({
          name: review.branch.slice(DRAFT_BRANCH_PREFIX.length),
          url: review.url,
          title: review.title,
        }))
        .filter((review) => isDraftName(review.name))
        .sort((a, b) => b.name.localeCompare(a.name));
    },
  };
}
