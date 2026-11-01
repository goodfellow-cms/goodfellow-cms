/**
 * Creating a site's repository from the browser, for the documentation site's
 * setup page. Each backend package implements it for its host, as it does
 * `GitHost` for editing an existing site.
 */
import type { FileChange } from "./content/store.js";
import type { SeparateSetupLinks } from "./content-repository-setup.js";
import type { GitUser, RedirectOptions, TokenLink } from "./git.js";

/** An account or group a new repository can be created in. */
export interface SetupOwner {
  /** As it appears in addresses: a GitHub user or organization, or a GitLab namespace's full path. */
  path: string;
  /** The name shown to people. */
  name: string;
  kind: "personal" | "organization";
  /** The host's own id for it, where creating a repository needs one (GitLab's namespace id). */
  id?: number;
  /** Where to install the sign-in service's app, when creating sites here needs it first. */
  installUrl?: string;
}

export interface NewSiteRepository {
  owner: SetupOwner;
  /** The repository's name, which is also the last part of its address. */
  name: string;
  private: boolean;
  description?: string;
  /** Turns on the host's own Pages (GitHub Pages or GitLab Pages) to publish the site. */
  pages: boolean;
  /**
   * A domain of its own for those Pages, such as a token broker's
   * `signin.example.org`, which GitHub Pages needs for an address no other
   * site shares. The person points it at the host as its settings say.
   */
  domain?: string;
  /** The site's files, all in the repository's first commit. */
  files: FileChange[];
  message: string;
  /**
   * Another repository is created with the same sign-in after this one, such
   * as the content's for a site that keeps it in a repository of its own, so
   * the sign-in isn't ended yet.
   */
  more?: boolean;
  /**
   * For the second of a site's code and content repositories, the other one
   * having been created already: they're connected before this one's files are
   * written, so that its first build can read the other.
   */
  link?: RepositoryLink;
}

/** A site's code repository and content repository, which `NewSiteRepository.link` connects. */
export interface RepositoryLink {
  /** The code repository: `owner/name`, or the GitLab project's full path. */
  code: string;
  content: string;
  /** Whether they're private, so reading one from the other needs it to let the reader in. */
  private: boolean;
  links: SeparateSetupLinks;
}

/** What creating a site is doing, for showing progress. */
export type SetupStep = "repository" | "pages" | "files" | "protection" | "connect";

/** Something that didn't stop the site being created, but needs the person's attention. */
export type SetupWarning =
  /** Pages couldn't be turned on, such as for a private repository on GitHub's free plan. */
  | "pages-unavailable"
  /** The Pages' own domain couldn't be set, such as one another site already has: set it in the host's settings. */
  | "domain-unavailable"
  /** The main branch's history couldn't be protected, such as on a plan without rules for private repositories. */
  | "protection-unavailable"
  /** Editors can't sign in with the sign-in service until its app is installed on the repository (`signInInstallUrl`). */
  | "sign-in-not-installed"
  /**
   * The code and content repositories couldn't be connected, such as where the
   * sign-in can't add deploy keys or secrets: their setup files say what to add,
   * and `unconnected` says what's left where the host says.
   */
  | "connect-unavailable";

/**
 * A connection between a site's code and content repositories that creating
 * it couldn't make, for the person to make in the host's settings, with what
 * the host answered as `reason`, for the setup page's Details.
 */
export type UnmadeConnection =
  /** `reader`'s pipelines can't read `read` yet: add `reader` to `read`'s job token allowlist (GitLab). */
  | { kind: "read"; reader: string; read: string; reason: string }
  /** `repo`'s pipelines can't publish Goodfellow's updates yet: allow its job token to push (GitLab). */
  | { kind: "push"; repo: string; reason: string }
  /** `repo` has no pipeline schedule to run each night yet (GitLab). */
  | { kind: "nightly"; repo: string; reason: string };

export interface CreatedSiteRepository {
  /** `owner/name`, or the GitLab project's full path. */
  repo: string;
  /** The repository's page on the host. */
  webUrl: string;
  /** Where the site will be online, if the host knows already. */
  siteUrl?: string;
  /** Where the site's builds can be watched. */
  buildsUrl: string;
  /** The host's Pages settings, where the site's address is shown once it's built. */
  pagesUrl?: string;
  /** Where to install the sign-in service's app on the repository, so editors can sign in with it. */
  signInInstallUrl?: string;
  warnings: SetupWarning[];
  /** With `connect-unavailable`, what's left to connect, where the host can say. */
  unconnected?: UnmadeConnection[];
}

/** Why a site couldn't be created, in a form the setup page turns into plain words. */
export type SetupProblem =
  /** There's already a repository with that name. */
  | "name-taken"
  /** The name can't be used for a repository. */
  | "name-invalid"
  /** The sign-in can't create repositories there, or can't write the site's build setup. */
  | "not-allowed"
  /** The sign-in service's app isn't installed where the repository would go. `link` says where to install it. */
  | "not-installed";

export class SetupError extends Error {
  override name = "SetupError";
  constructor(
    readonly problem: SetupProblem,
    message: string,
    readonly link?: string,
  ) {
    super(message);
  }
}

/** A signed-in account that can create repositories. */
export interface SetupAccount {
  user: GitUser;
  /** The accounts and groups the person can create repositories in, their own first. */
  owners(): Promise<SetupOwner[]>;
  /** Whether a repository with this name can still be created there. */
  isAvailable(owner: SetupOwner, name: string): Promise<boolean>;
  createSite(site: NewSiteRepository, onStep?: (step: SetupStep) => void): Promise<CreatedSiteRepository>;
}

/** Signing in to a git host to create a site. Tokens are kept in memory only, since they're needed just once. */
export interface SetupHost {
  /** The host's name, such as "GitHub". */
  name: string;
  /** Whether "Sign in with …" by redirect is available. */
  canRedirect: boolean;
  /** Where to create a token for signing in, with what the setup page needs. */
  tokenLinks: TokenLink[];
  /** Finishes signing in if the page has just come back from the host's sign-in page. */
  restore(): Promise<SetupAccount | null>;
  signInWithToken(token: string): Promise<SetupAccount>;
  /** Goes to the host's sign-in page, which comes back to this page. */
  startRedirect(options?: RedirectOptions): Promise<void>;
}
