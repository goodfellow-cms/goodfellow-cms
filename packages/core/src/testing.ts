/**
 * An in-memory git repository for testing backends without calling a real git
 * host. Each backend package builds a fake of its host's API on top of it.
 * Never shipped to browsers: import it only from tests.
 */
import type { FileChange } from "./content/store.js";

/** A file in a fake repository: text, or bytes for files that aren't text, such as images. */
export type FakeFile = string | Uint8Array;

export interface FakeCommit {
  sha: string;
  parent?: string;
  message: string;
  /** Who made it, if anyone said. */
  author?: string;
  /** When it was made, as an ISO 8601 date. */
  date: string;
  files: ReadonlyMap<string, FakeFile>;
}

/** Commits are an hour apart from here, so tests get the same dates every time. */
const FIRST_COMMIT = Date.UTC(2026, 0, 5, 9);

/** A file's content as a string to hash or compare: bytes become one character per byte. */
function fileKey(file: FakeFile | undefined): string | undefined {
  if (file === undefined || typeof file === "string") return file;
  let key = "\0bytes:";
  for (const byte of file) key += String.fromCharCode(byte);
  return key;
}

/**
 * Stores uploaded bytes as text when they are valid UTF-8, so text files read
 * back as strings whichever way they were written.
 */
export function fakeFileFromBytes(bytes: Uint8Array): FakeFile {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
}

/** A fake file's bytes. */
export function fakeFileBytes(file: FakeFile): Uint8Array<ArrayBuffer> {
  return new Uint8Array(typeof file === "string" ? new TextEncoder().encode(file) : file);
}

export class FakeConflictError extends Error {
  override name = "FakeConflictError";
}

function fakeHash(text: string, seed: number): string {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A pull or merge request opened in the fake host. */
export interface FakeReview {
  number: number;
  branch: string;
  target: string;
  title: string;
  description: string;
  state: "open" | "merged" | "closed";
}

export class FakeRepo {
  readonly commits = new Map<string, FakeCommit>();
  readonly branches = new Map<string, string>();
  readonly blobs = new Map<string, FakeFile>();
  /** Pull or merge requests, in the order they were opened. */
  readonly reviews: FakeReview[] = [];
  private count = 0;

  constructor(
    files: Record<string, FakeFile> = {},
    public defaultBranch = "main",
  ) {
    const sha = this.addCommit(undefined, "Initial commit", new Map(Object.entries(files)));
    this.branches.set(defaultBranch, sha);
  }

  /** A 40-character content hash, like git's blob ids. */
  blobSha(content: FakeFile): string {
    const key = fileKey(content) ?? "";
    const sha = [1, 2, 3, 4, 5].map((seed) => fakeHash(key, seed)).join("");
    this.blobs.set(sha, content);
    return sha;
  }

  head(branch = this.defaultBranch): string {
    const sha = this.branches.get(branch);
    if (!sha) throw new Error(`No branch ${branch}`);
    return sha;
  }

  commitAt(sha: string): FakeCommit | undefined {
    return this.commits.get(sha);
  }

  files(ref: string = this.defaultBranch): ReadonlyMap<string, FakeFile> {
    const commit = this.commits.get(this.branches.get(ref) ?? ref);
    if (!commit) throw new Error(`No commit ${ref}`);
    return commit.files;
  }

  /** Commits changes to a branch. Throws `FakeConflictError` if `expectedHead` is given and the branch has moved. */
  commit(
    changes: FileChange[],
    message: string,
    options: { branch?: string; expectedHead?: string; author?: string } = {},
  ): string {
    const branch = options.branch ?? this.defaultBranch;
    const parent = this.head(branch);
    if (options.expectedHead && options.expectedHead !== parent) throw new FakeConflictError(`${branch} has moved`);
    const files = new Map(this.files(parent));
    for (const change of changes) {
      if ("delete" in change) files.delete(change.path);
      else files.set(change.path, "bytes" in change ? fakeFileFromBytes(change.bytes) : change.content);
    }
    const sha = this.addCommit(parent, message, files, options.author);
    this.branches.set(branch, sha);
    return sha;
  }

  /** Simulates someone else saving: commits straight to the branch. */
  write(path: string, content: string, message = `Edit ${path}`, author?: string): string {
    return this.commit([{ path, content }], message, { author });
  }

  /**
   * The commits at or before `ref` that changed `path`, newest first, as git
   * hosts list a file's history, or for a folder, anything in it.
   */
  history(path: string, ref: string = this.defaultBranch): FakeCommit[] {
    const found: FakeCommit[] = [];
    const folder = `${path.replace(/\/+$/, "")}/`;
    const changed = (commit: FakeCommit, parent: FakeCommit | undefined) => {
      if (fileKey(commit.files.get(path)) !== fileKey(parent?.files.get(path))) return true;
      const paths = new Set([...commit.files.keys(), ...(parent?.files.keys() ?? [])]);
      return [...paths].some(
        (file) => file.startsWith(folder) && fileKey(commit.files.get(file)) !== fileKey(parent?.files.get(file)),
      );
    };
    let commit = this.commits.get(this.branches.get(ref) ?? ref);
    while (commit) {
      const parent = commit.parent ? this.commits.get(commit.parent) : undefined;
      if (changed(commit, parent)) found.push(commit);
      commit = parent;
    }
    return found;
  }

  changedPaths(from: string, to: string): string[] {
    const a = this.files(from);
    const b = this.files(to);
    return [...new Set([...a.keys(), ...b.keys()])]
      .filter((path) => fileKey(a.get(path)) !== fileKey(b.get(path)))
      .sort();
  }

  /** The newest commit that both refs (branches or commits) have, as `git merge-base` finds it. */
  mergeBase(a: string, b: string): string | undefined {
    const ancestors = new Set<string>();
    for (let commit = this.commits.get(this.branches.get(a) ?? a); commit; ) {
      ancestors.add(commit.sha);
      commit = commit.parent ? this.commits.get(commit.parent) : undefined;
    }
    for (let commit = this.commits.get(this.branches.get(b) ?? b); commit; ) {
      if (ancestors.has(commit.sha)) return commit.sha;
      commit = commit.parent ? this.commits.get(commit.parent) : undefined;
    }
    return undefined;
  }

  /** Opens a pull or merge request, or gives the open one from the same branch. */
  openReview(branch: string, title: string, description: string, target = this.defaultBranch): FakeReview {
    const open = this.reviews.find((review) => review.branch === branch && review.state === "open");
    if (open) return open;
    const review: FakeReview = { number: this.reviews.length + 1, branch, target, title, description, state: "open" };
    this.reviews.push(review);
    return review;
  }

  /** The most recent commit at or before `ref` that changed `path`. */
  lastCommitFor(path: string, ref: string = this.defaultBranch): string | undefined {
    let commit = this.commits.get(this.branches.get(ref) ?? ref);
    while (commit) {
      const parent = commit.parent ? this.commits.get(commit.parent) : undefined;
      if (fileKey(commit.files.get(path)) !== fileKey(parent?.files.get(path)))
        return commit.files.has(path) || parent ? commit.sha : undefined;
      commit = parent;
    }
    return undefined;
  }

  /** Makes a commit with these files, without moving any branch, as git hosts' APIs can. */
  addCommit(parent: string | undefined, message: string, files: Map<string, FakeFile>, author?: string): string {
    const date = new Date(FIRST_COMMIT + this.count * 3_600_000).toISOString();
    this.count += 1;
    const sha = this.count.toString(16).padStart(40, "0");
    for (const content of files.values()) this.blobSha(content);
    this.commits.set(sha, { sha, parent, message, author, date, files });
    return sha;
  }
}

export {
  type FakeTheme,
  type FakeThemeRelease,
  type FakeThemesOptions,
  type FakeThemesResponse,
  fakeThemes,
  sampleThemeFiles,
} from "./themes-testing.js";
export {
  type FakeWordPressOptions,
  type FakeWordPressResponse,
  fakeWordPress,
  SAMPLE_IMAGE,
  SAMPLE_WORDPRESS_URL,
  sampleWordPressExport,
} from "./wordpress/sample.js";
