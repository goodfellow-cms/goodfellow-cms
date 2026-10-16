import type { BuildProblem } from "./build-problems.js";
import type { ContentStore } from "./content/store.js";
import type { PagesDomains } from "./domains.js";
import type { SiteDrafts } from "./drafts.js";
import type { OwnerAccess, SiteEditors } from "./editors.js";
import type { SiteUpdates } from "./updates.js";

/** The person signed in to the admin panel. */
export interface GitUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Whether a published revision has reached the live site.
 * `unknown` means the host doesn't report it (for example, no deploy is set up).
 */
export type DeployState = "building" | "live" | "failed" | "unknown";

export interface DeployStatus {
  state: DeployState;
  /** Where to see what happened, such as the build log. */
  detailsUrl?: string;
  /** For a failed rebuild, why, as far as the host says. */
  problem?: BuildProblem;
}

/** One published version of a file. */
export interface FileVersion {
  /** The commit it was published in, which `readAt()` reads the file at. */
  revision: string;
  /** When it was published, as an ISO 8601 date. */
  date: string;
  /** Who published it, as the host names them. */
  author?: string;
  /** What the publish said, such as "Update About". */
  message: string;
}

export interface HistoryOptions {
  /** Which page of versions, from 1 (the newest). */
  page?: number;
  /** Versions per page. Defaults to 20. */
  perPage?: number;
}

/** A signed-in connection to the git host that stores the site. */
export interface GitBackend extends ContentStore {
  readonly user: GitUser;
  changedPaths(from: string, to: string): Promise<string[]>;
  deployStatus(revision: string): Promise<DeployStatus>;
  /**
   * The published versions of a file, newest first, up to the revision reads
   * are pinned to. A file that was moved starts again at its new path.
   */
  history(path: string, options?: HistoryOptions): Promise<FileVersion[]>;
  /** A file's text in an earlier version, or `undefined` if it didn't exist then. */
  readAt(path: string, revision: string): Promise<string | undefined>;
  /** The git host's own Pages, for connecting a custom domain. Absent where the backend can't. */
  readonly pages?: PagesDomains;
  /** Who can edit the site, and inviting and removing them. Absent where the backend can't. */
  readonly editors?: SiteEditors;
  /** A second token for changing editors and Pages settings, where signing in can't. */
  readonly ownerAccess?: OwnerAccess;
  /** The site's nightly update job: its last run, and running it now. Absent where the backend can't. */
  readonly updates?: SiteUpdates;
  /** Changes kept on a branch of their own until they're published or submitted for review. Absent where the backend can't. */
  readonly drafts?: SiteDrafts;
  /**
   * Whether the repository holds only the site's content (`content/` and
   * `public/media/`), with its code in a repository of its own. Writes to
   * anything else throw `CodeChangeError`, so blocks are added by a developer.
   */
  readonly contentOnly?: boolean;
  /** Forgets the saved sign-in. */
  signOut(): void;
}

/**
 * A link for creating an access token. `label` and `hint` are keys in the
 * admin panel's string table, so backends never supply UI text themselves.
 */
export interface TokenLink {
  url: string;
  label: "signIn.token.create" | "signIn.token.createBroad" | "owner.token.create";
  hint?: "signIn.token.createBroadHint";
}

/** How people sign in to a git host. */
export interface GitHost {
  /** The host's name, shown in the admin panel, such as "GitHub". */
  readonly name: string;
  /** Present when people can sign in by pasting an access token. */
  readonly tokenLinks?: TokenLink[];
  /** Whether people can sign in by being sent to the host and back. */
  readonly canRedirect: boolean;
  /**
   * Whether that sign-in comes back only to addresses listed with the host
   * itself, such as a GitLab OAuth application's, so a new domain must be
   * added there. GitHub's sign-in worker follows the Site address instead.
   */
  readonly redirectAddressesListed?: boolean;
  /**
   * Resumes a saved sign-in, or finishes a redirect sign-in when the page has
   * just come back from the host. Returns `null` when nobody is signed in.
   */
  restore(): Promise<GitBackend | null>;
  /** Signs in with an access token. `remember` keeps it after the browser closes. */
  signInWithToken(token: string, remember: boolean): Promise<GitBackend>;
  /** Sends the browser to the host to sign in. Only when `canRedirect`. */
  startRedirect(remember: boolean, options?: RedirectOptions): Promise<void>;
  /**
   * Reaches the site's repository from a full-stack site's own server, with a
   * token of the site's rather than an editor's, which never reaches a browser.
   */
  server?(options: ServerGitOptions): ServerGit;
}

/** Who a commit names as its author. */
export interface CommitAuthor {
  name: string;
  email: string;
}

export interface ServerGitOptions {
  /**
   * A token that can read and publish to the site's repository, such as a
   * fine-grained GitHub token or a GitLab project access token, from an
   * environment variable. A function is asked for it on each request, for tokens that renew.
   */
  token: string | (() => Promise<string>);
}

/** The site's repository as a full-stack site's server reaches it: one token, for every editor. */
export interface ServerGit {
  /** Whether the repository holds only the site's content, as `GitBackend.contentOnly`. */
  readonly contentOnly?: boolean;
  /** The newest revision of the live branch. */
  revision(): Promise<string>;
  /**
   * A backend whose reads see `revision`, as an editor's browser loaded it, and
   * whose commits name `author`, the editor the site's own sign-in says it is.
   */
  at(revision: string, author?: CommitAuthor): Promise<GitBackend>;
}

/** How to sign in by going to the host and back. */
export interface RedirectOptions {
  /**
   * Installs the sign-in service's app first, where its app isn't installed
   * yet (`SignInError`'s `not-installed`): the host's install page signs the person in too.
   */
  install?: boolean;
}

export type SignInProblem =
  /** The token or sign-in was rejected, or has expired. */
  | "invalid"
  /** The account can't see the site's repository. */
  | "no-access"
  /** The account can see the site but can't publish to it. */
  | "cant-publish"
  /** Coming back from the host failed, for example because sign-in was cancelled. */
  | "redirect-failed"
  /** The sign-in service's app isn't installed on the site's repository. `link` says where to install it. */
  | "not-installed"
  /** The site's settings don't have its address, which the sign-in service only comes back to. */
  | "no-address"
  /** The admin panel isn't at the address the site's settings list. */
  | "wrong-address"
  /** The admin panel is on this computer, which the sign-in service never gives tokens to. */
  | "local-address"
  /** The account isn't an owner of the site, as an owner's sign-in needs. */
  | "not-owner"
  /**
   * The sign-in service can't be reached or isn't working, such as when it's
   * been used as much as its host allows for the day.
   */
  | "unavailable";

/** Thrown when signing in fails, or when a saved sign-in stops working. */
export class SignInError extends Error {
  override name = "SignInError";
  readonly problem: SignInProblem;
  /** Where to fix it, such as the page that installs the sign-in service's app. */
  readonly link?: string;

  constructor(problem: SignInProblem, message: string, link?: string) {
    super(message);
    this.problem = problem;
    if (link) this.link = link;
  }
}

/** Thrown when a git host answers with an unexpected error. */
export class GitApiError extends Error {
  override name = "GitApiError";
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The subset of the Web Storage API that sign-in uses, so it can be replaced in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Saves sign-in details where the person chose: in local storage if they asked
 * to stay signed in, otherwise in session storage, which the browser clears when it closes.
 */
export function credentialStorage(
  key: string,
  storages: { local?: StorageLike; session?: StorageLike } = defaultStorages(),
) {
  return {
    load(): string | null {
      return storages.session?.getItem(key) ?? storages.local?.getItem(key) ?? null;
    },
    save(value: string, remember: boolean): void {
      (remember ? storages.session : storages.local)?.removeItem(key);
      (remember ? storages.local : storages.session)?.setItem(key, value);
    },
    clear(): void {
      storages.local?.removeItem(key);
      storages.session?.removeItem(key);
    },
    /** Whether the saved value is in local storage (the person chose to stay signed in). */
    remembered(): boolean {
      return storages.local?.getItem(key) != null;
    },
  };
}

function defaultStorages(): { local?: StorageLike; session?: StorageLike } {
  const scope = globalThis as { localStorage?: StorageLike; sessionStorage?: StorageLike };
  try {
    return { local: scope.localStorage, session: scope.sessionStorage };
  } catch {
    // Storage can be blocked entirely, for example in some private windows.
    return {};
  }
}

/** Encodes bytes as base64. */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Encodes text as base64, handling any Unicode. */
export function encodeBase64(text: string): string {
  return encodeBase64Bytes(new TextEncoder().encode(text));
}

/** Decodes base64 into bytes. */
export function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
