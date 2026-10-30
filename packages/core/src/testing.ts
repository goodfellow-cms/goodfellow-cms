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

/** SHA-1, in plain JavaScript so the fakes run anywhere, synchronously. */
function sha1(bytes: Uint8Array): string {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0);
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const next = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = next;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** Git's id for a file: the SHA-1 of `blob <size>\0` and its bytes, as hosts list them. */
export function gitBlobSha(file: FakeFile): string {
  const bytes = fakeFileBytes(file);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  return sha1(data);
}

/** A pull or merge request opened in the fake host. */
export interface FakeReview {
  number: number;
  branch: string;
  target: string;
  title: string;
  description: string;
  state: "open" | "merged" | "closed";
  /** Who was asked to review it, by sign-in name. */
  reviewers: string[];
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

  /** The file's id, as git gives it. */
  blobSha(content: FakeFile): string {
    const sha = gitBlobSha(content);
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
  openReview(
    branch: string,
    title: string,
    description: string,
    target = this.defaultBranch,
    reviewers: readonly string[] = [],
  ): FakeReview {
    const open = this.reviews.find((review) => review.branch === branch && review.state === "open");
    if (open) return open;
    const review: FakeReview = {
      number: this.reviews.length + 1,
      branch,
      target,
      title,
      description,
      state: "open",
      reviewers: [...reviewers],
    };
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
  type FakePlugin,
  type FakePluginsOptions,
  type FakeTheme,
  type FakeThemeRelease,
  type FakeThemesOptions,
  type FakeThemesResponse,
  fakePlugins,
  fakeThemes,
  fakeVerifier,
  samplePluginFiles,
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
