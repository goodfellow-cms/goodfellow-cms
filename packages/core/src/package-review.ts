/**
 * What a plugin's packages' code does, read before it's installed: the
 * plugin's own package and the packages it needs, at the releases the site's
 * workflow would write into the lockfile (the newest in range that's
 * `RELEASE_AGE_DAYS` old), from jsDelivr. It reads the code as text and notes
 * what it could do that owners should know about: network requests, running
 * other programs, running code made from text (`eval`), native code, and
 * scripts npm would run on install. Code can always hide what it does, so
 * these are things to look at, never a promise that nothing else is there.
 */
import {
  getPackageJson,
  JSDELIVR_DATA,
  oldEnough,
  type PackageFetchOptions,
  type PackageRelease,
  packageFetch,
  packageFileUrl,
  packageMetadataUrl,
  releasesIn,
} from "./npm-packages.js";
import { inRange } from "./updates.js";

export type CodeNoteKind = "network" | "programs" | "eval" | "native" | "install-script";

/** Something a package's code could do, where it is. */
export interface CodeNote {
  kind: CodeNoteKind;
  /** The file, from the package's root. */
  file: string;
  line?: number;
  /** The code around it, on one line. */
  excerpt: string;
}

/** Why some of a package wasn't read. */
export type UnreadReason = "too-large" | "too-many" | "no-release" | "range" | "unavailable";

export interface PackageReview {
  name: string;
  version: string;
  /** How it's reached from the plugin: none for the plugin itself, then each package that needs it. */
  via: string[];
  /** Notes, at most `MAX_NOTES` of each kind; `counts` has them all. */
  notes: CodeNote[];
  counts: Partial<Record<CodeNoteKind, number>>;
  /** Code files read, and code files it has. */
  read: number;
  files: number;
  /** Where some or all of it wasn't read, why. */
  unread?: UnreadReason;
}

/** At most this many packages are read, the plugin's own first. */
export const MAX_REVIEWED_PACKAGES = 40;
/** Files larger than this aren't read. */
export const MAX_REVIEWED_FILE_BYTES = 1_000_000;
/** At most this much of a package's code is read. */
export const MAX_REVIEWED_PACKAGE_BYTES = 4_000_000;
/** At most this many notes of each kind are kept for a package. */
export const MAX_NOTES = 5;

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TYPES_FILE = /\.d\.[cm]?ts$/;
const NATIVE_FILE = /\.(?:node|wasm)$/;
const NET = "(?:node:)?(?:https?|http2|net|tls|dgram|dns)";

const PATTERNS: [CodeNoteKind, RegExp][] = [
  ["network", /(?<![\w$.])fetch\s*\(/g],
  ["network", /\bXMLHttpRequest\b/g],
  ["network", /\bnew\s+(?:WebSocket|EventSource)\b/g],
  ["network", /\bsendBeacon\b/g],
  ["network", new RegExp(`\\brequire\\s*\\(\\s*["'\`]${NET}["'\`]\\s*\\)`, "g")],
  ["network", new RegExp(`\\bfrom\\s*["']${NET}["']`, "g")],
  ["network", new RegExp(`\\bimport\\s*\\(\\s*["'\`]${NET}["'\`]\\s*\\)`, "g")],
  ["programs", /["'`](?:node:)?child_process["'`]/g],
  ["programs", /\bBun\.spawn/g],
  ["programs", /\bDeno\.(?:run|Command)\b/g],
  ["eval", /(?<![\w$.])eval\s*\(/g],
  ["eval", /\bnew\s+Function\s*\(/g],
  ["eval", /["'`](?:node:)?vm["'`]/g],
  ["eval", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g],
  ["eval", /(?<![\w$.])import\s*\(\s*(?!["'`\s)])/g],
  ["native", /\bprocess\.dlopen\b/g],
  ["native", /\bWebAssembly\.(?:instantiate|compile)(?:Streaming)?\b/g],
];

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** What a file's code could do, as notes, in the order they're found. */
export function codeNotes(file: string, text: string): CodeNote[] {
  const found: (CodeNote & { index: number })[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      found.push({ kind, file, index, excerpt: excerpt(text, index, match[0].length) });
    }
  }
  found.sort((a, b) => a.index - b.index);
  // Line numbers, counted once for every note.
  let line = 1;
  let at = 0;
  return found.map(({ index, ...note }) => {
    for (; at < index; at++) if (text.charCodeAt(at) === 10) line++;
    return { ...note, line };
  });
}

interface Pending {
  name: string;
  release: PackageRelease;
  via: string[];
}

/** jsDelivr's flat list of a release's files: paths from its root with their sizes. */
async function listFiles(name: string, version: string, options: PackageFetchOptions) {
  const answer = (await getPackageJson(
    `${JSDELIVR_DATA}/${name}@${version}?structure=flat`,
    packageFetch(options),
  )) as { files?: { name?: unknown; size?: unknown }[] };
  return (answer.files ?? []).flatMap((file) =>
    typeof file.name === "string" ? [{ path: file.name.replace(/^\//, ""), size: Number(file.size) || 0 }] : [],
  );
}

async function reviewOne(pending: Pending, options: PackageFetchOptions): Promise<PackageReview> {
  const { name, release, via } = pending;
  const review: PackageReview = { name, version: release.version, via, notes: [], counts: {}, read: 0, files: 0 };
  const add = (note: CodeNote) => {
    review.counts[note.kind] = (review.counts[note.kind] ?? 0) + 1;
    if (review.notes.filter((kept) => kept.kind === note.kind).length < MAX_NOTES) review.notes.push(note);
  };
  for (const [script, command] of Object.entries(release.installScripts ?? {})) {
    add({ kind: "install-script", file: "package.json", excerpt: `${script}: ${command}` });
  }
  let files: { path: string; size: number }[];
  try {
    files = await listFiles(name, release.version, options);
  } catch {
    return { ...review, unread: "unavailable" };
  }
  for (const file of files)
    if (NATIVE_FILE.test(file.path)) add({ kind: "native", file: file.path, excerpt: file.path });
  const code = files.filter((file) => CODE_FILE.test(file.path) && !TYPES_FILE.test(file.path));
  review.files = code.length;
  let bytes = 0;
  for (const file of code) {
    if (file.size > MAX_REVIEWED_FILE_BYTES || bytes + file.size > MAX_REVIEWED_PACKAGE_BYTES) {
      review.unread = "too-large";
      continue;
    }
    bytes += file.size;
    let text: string;
    try {
      const response = await packageFetch(options)(packageFileUrl(name, release.version, file.path));
      if (!response.ok) throw new Error(String(response.status));
      text = await response.text();
    } catch {
      review.unread = "unavailable";
      continue;
    }
    review.read++;
    for (const note of codeNotes(file.path, text)) add(note);
  }
  return review;
}

/** The release npm would pick for a range: the newest in it that's old enough, as `npm install --before` does. */
export function resolveRange(
  releases: readonly PackageRelease[],
  range: string,
  now: Date,
): PackageRelease | undefined {
  const exact = /^\d+\.\d+\.\d+$/.test(range.trim()) ? range.trim() : undefined;
  return [...releases]
    .reverse()
    .find(
      (release) => (exact ? release.version === exact : inRange(release.version, range)) && oldEnough(release, now),
    );
}

export interface ReviewOptions extends PackageFetchOptions {
  /** Packages the site has already, which aren't read again, by name. */
  known?: Iterable<string>;
  now?: Date;
  /** Told about each package as it's read, for showing progress. */
  onPackage?: (review: PackageReview) => void;
}

/**
 * Reads a plugin's release and the packages it needs, one level after
 * another, at most `MAX_REVIEWED_PACKAGES`, leaving out packages the site
 * has already. Packages that couldn't be read are listed with why.
 */
export async function reviewPluginPackages(
  name: string,
  release: PackageRelease,
  options: ReviewOptions = {},
): Promise<PackageReview[]> {
  const now = options.now ?? new Date();
  const known = new Set(options.known ?? []);
  const seen = new Set<string>([name]);
  const reviews: PackageReview[] = [];
  let queue: Pending[] = [{ name, release, via: [] }];
  const skipped = (pending: { name: string; via: string[] }, version: string, unread: UnreadReason) => {
    const review: PackageReview = { ...pending, version, notes: [], counts: {}, read: 0, files: 0, unread };
    reviews.push(review);
    options.onPackage?.(review);
  };
  while (queue.length > 0) {
    const next: Pending[] = [];
    for (const pending of queue) {
      if (reviews.length >= MAX_REVIEWED_PACKAGES) {
        skipped(pending, pending.release.version, "too-many");
        continue;
      }
      const review = await reviewOne(pending, options);
      reviews.push(review);
      options.onPackage?.(review);
      for (const [dependency, range] of Object.entries(pending.release.dependencies ?? {})) {
        if (seen.has(dependency) || known.has(dependency)) continue;
        seen.add(dependency);
        const via = [...pending.via, pending.name];
        // Ranges such as `npm:other@1` or a git address aren't releases on npm, which the review reads.
        if (!/^[\d^~<>=*x.|\s-]+$/i.test(range)) {
          skipped({ name: dependency, via }, range, "range");
          continue;
        }
        let releases: PackageRelease[];
        try {
          releases = releasesIn(await getPackageJson(packageMetadataUrl(dependency), packageFetch(options)));
        } catch {
          skipped({ name: dependency, via }, range, "unavailable");
          continue;
        }
        const resolved = resolveRange(releases, range, now);
        if (!resolved) skipped({ name: dependency, via }, range, "no-release");
        else next.push({ name: dependency, release: resolved, via });
      }
    }
    queue = next;
  }
  return reviews;
}
