import {
  type CommitAuthor,
  credentialStorage,
  GitApiError,
  type GitHost,
  type RedirectOptions,
  type ServerGit,
  type ServerGitOptions,
  SignInError,
  type StorageLike,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest, repoPath } from "./api.js";
import { GitHubBackend } from "./backend.js";
import {
  type BrowserLocation,
  browserLocation,
  ERROR_PARAM,
  GOODFELLOW_SIGN_IN,
  GRANT_PARAM,
  type IssuedToken,
  isLocalAddress,
  newVerifier,
  renewingToken,
  SignInService,
  signInProblem,
} from "./sign-in.js";

export { GitHubBackend } from "./backend.js";
export { githubPagesRecords } from "./pages.js";
export { type GitHubSetupOptions, githubSetup, githubSetupTokenLinks } from "./setup.js";
export { type BrowserLocation, GOODFELLOW_SIGN_IN } from "./sign-in.js";

export interface GitHubOptions {
  /** The site's repository, as `owner/name`. */
  repo: string;
  /** The branch the live site is built from. Defaults to the repository's default branch. */
  branch?: string;
  /** For GitHub Enterprise. Defaults to `https://api.github.com`. */
  apiUrl?: string;
  /** For GitHub Enterprise. Defaults to `https://github.com`. */
  webUrl?: string;
  /**
   * The sign-in worker, which lets editors sign in with GitHub instead of
   * pasting a token. Defaults to Goodfellow's (`GOODFELLOW_SIGN_IN`); give the
   * address of your own copy, or `false` for token sign-in only.
   */
  signIn?: string | false;
  /**
   * The repository holds only the site's content (`content/` and
   * `public/media/`), and its code is in a repository of its own. The admin
   * panel then leaves adding blocks, which changes code, to a developer.
   */
  contentOnly?: boolean;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  storage?: { local?: StorageLike; session?: StorageLike };
  /** For tests. */
  location?: BrowserLocation;
}

/** What's saved for a signed-in editor: a token they pasted, or a session with the sign-in worker. */
type Saved = { type: "token"; token: string } | { type: "worker"; session: string };

/** A sign-in through the worker on its way: this tab's verifier, and what it's for. */
interface PendingRedirect {
  verifier: string;
  purpose: "edit" | "owner";
  remember: boolean;
}

/** Saved sign-ins to forget when they stop working: not when the worker can't be reached, which passes. */
function forgets(error: unknown): boolean {
  return error instanceof SignInError && error.problem !== "unavailable";
}

/**
 * Links to GitHub's token page with everything filled in except the
 * repository, which GitHub doesn't let links choose.
 */
export function githubTokenLinks(repo: string, webUrl = "https://github.com") {
  const [repoOwner = ""] = repo.split("/");
  const fineGrained = new URLSearchParams({
    name: "Goodfellow admin",
    description: `Edit ${repo} in its admin panel`,
    target_name: repoOwner,
    expires_in: "90",
    contents: "write",
    deployments: "read",
    // Which step of a failed rebuild failed, so the admin panel can explain it.
    actions: "read",
  });
  const classic = new URLSearchParams({ scopes: "repo", description: `Goodfellow admin for ${repo}` });
  // Changing editors and GitHub Pages settings needs permissions signing in doesn't ask for, including
  // Administration, which can also delete the repository. So owners make a second token, used for one tab only.
  const owner = new URLSearchParams({
    name: "Goodfellow owner",
    description: `Manage the editors, domain and updates of ${repo}`,
    target_name: repoOwner,
    // GitHub's shortest: the admin panel forgets the token when the tab closes anyway.
    expires_in: "1",
    administration: "write",
    pages: "write",
    // Running the site's update now, from the Updates screen.
    actions: "write",
  });
  return {
    fineGrained: `${webUrl}/settings/personal-access-tokens/new?${fineGrained}`,
    classic: `${webUrl}/settings/tokens/new?${classic}`,
    owner: `${webUrl}/settings/personal-access-tokens/new?${owner}`,
  };
}

/** Sign-in and storage for a site whose repository is on GitHub. */
export function github(options: GitHubOptions): GitHost {
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
    throw new Error(`github({ repo }) must look like "owner/name" (got "${options.repo}").`);
  }
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const links = githubTokenLinks(options.repo, options.webUrl);
  const storage = credentialStorage(`goodfellow:github:${options.repo}`, options.storage);
  const pending = credentialStorage(`goodfellow:github:pending:${options.repo}`, options.storage);
  const fetcher: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const location = options.location ?? browserLocation();
  const signInUrl = options.signIn === undefined ? GOODFELLOW_SIGN_IN : options.signIn;
  // Never on this computer: the worker doesn't give tokens there, and `goodfellow dev` doesn't need one.
  const service =
    signInUrl && location && !isLocalAddress(location.href()) ? new SignInService(signInUrl, fetcher) : undefined;

  function save(value: Saved, remember: boolean): void {
    // Tokens are saved on their own, as they were before sessions with the worker.
    storage.save(value.type === "token" ? value.token : JSON.stringify(value), remember);
  }

  function loadSaved(): Saved | undefined {
    const value = storage.load();
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as Saved;
      if (parsed.type === "worker" || parsed.type === "token") return parsed;
    } catch {
      // Saved before sign-in through the worker: the token on its own.
    }
    return { type: "token", token: value };
  }

  /**
   * Sends the browser to GitHub through the worker, which comes back to this
   * screen. With `install`, GitHub's install page installs Goodfellow first.
   */
  async function redirect(purpose: "edit" | "owner", remember: boolean, { install }: RedirectOptions = {}) {
    if (!service || !location) throw new SignInError("unavailable", "Signing in with GitHub isn't available here.");
    // Until Goodfellow is installed, there's nothing to check: the worker checks the address on the way back.
    if (!install) await service.check(options.repo, purpose);
    const { verifier, challenge } = await newVerifier();
    pending.save(JSON.stringify({ verifier, purpose, remember } satisfies PendingRedirect), false);
    location.assign(
      service.startUrl({ purpose, repo: options.repo, back: location.href(), challenge, remember, install }),
    );
  }

  /** Connects with a session from the worker, whose tokens renew themselves. */
  async function connectWorker(issued: IssuedToken, remember: boolean): Promise<GitHubBackend> {
    const worker = service as SignInService;
    const source = renewingToken(worker, issued, (renewed) =>
      save({ type: "worker", session: renewed.session }, remember),
    );
    save({ type: "worker", session: issued.session }, remember);
    const api: ApiOptions = { apiUrl, token: source.token, fetch: fetcher };
    const repo = await githubJson<{ default_branch: string }>(api, `/repos/${repoPath(options.repo)}`);
    const { user } = issued;
    return new GitHubBackend({
      api,
      repo: options.repo,
      branch: options.branch ?? repo.default_branch,
      ...(options.contentOnly && { contentOnly: true }),
      user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl },
      author: { name: user.name || user.login, email: user.email },
      onSignOut: () => {
        // The worker kept nothing, so forgetting the session is signing out; the token it gave stops working too.
        storage.clear();
        revokeToken(source.current().token);
      },
      ownerTokenLink: { url: links.owner, label: "owner.token.create" },
      ownerRedirect: (redirectOptions) => redirect("owner", false, redirectOptions),
    });
  }

  /** Revokes a token the worker gave, as signing out does. Never fails: signing out goes ahead regardless. */
  function revokeToken(token: string): void {
    void githubRequest({ apiUrl, token, fetch: fetcher }, "/installation/token", { method: "DELETE" }).catch(() => {});
  }

  /** Gives the backend an owner's sign-in that has just come back from GitHub. It's kept in memory only. */
  async function useOwner(backend: GitHubBackend, grant: string, verifier: string): Promise<void> {
    const worker = service as SignInService;
    try {
      const issued = await worker.session(grant, verifier);
      const source = renewingToken(worker, issued, () => {});
      backend.useOwnerSignIn(source.token, () => revokeToken(source.current().token));
    } catch (error) {
      backend.ownerSignInFailed(error);
    }
  }

  /** Finishes a sign-in through the worker if the page has just come back from it. */
  async function completeRedirect(): Promise<GitHubBackend | null | undefined> {
    if (!location) return undefined;
    const url = new URL(location.href());
    const grant = url.searchParams.get(GRANT_PARAM);
    const failed = url.searchParams.get(ERROR_PARAM);
    if (!grant && !failed) return undefined;
    // Remove the sign-in's details from the address bar, staying on the screen it started from.
    url.searchParams.delete(GRANT_PARAM);
    url.searchParams.delete(ERROR_PARAM);
    location.replace(url.toString());
    const saved = pending.load();
    pending.clear();
    const redirect = saved ? (JSON.parse(saved) as PendingRedirect) : undefined;
    if (!redirect || !service) {
      throw new SignInError("redirect-failed", "Signing in with GitHub didn't finish in this tab.");
    }
    if (redirect.purpose === "owner") {
      // The owner's sign-in is on top of the editor's own, which is restored as usual.
      const backend = await restoreSaved();
      if (!backend) throw new SignInError("redirect-failed", "Sign in again, then sign in as an owner.");
      if (failed) backend.ownerSignInFailed(signInProblem({ problem: failed }));
      else if (grant) await useOwner(backend, grant, redirect.verifier);
      return backend;
    }
    if (failed || !grant) throw signInProblem({ problem: failed });
    return connectWorker(await service.session(grant, redirect.verifier), redirect.remember);
  }

  async function restoreSaved(): Promise<GitHubBackend | null> {
    const saved = loadSaved();
    if (!saved) return null;
    try {
      if (saved.type === "token") return await connect(saved.token);
      if (!service) {
        storage.clear();
        return null;
      }
      return await connectWorker(await service.token(saved.session), storage.remembered());
    } catch (error) {
      if (forgets(error)) storage.clear();
      throw error;
    }
  }

  async function connect(token: string): Promise<GitHubBackend> {
    const api: ApiOptions = { apiUrl, token, fetch: fetcher };
    const user = await githubJson<{ login: string; name?: string | null; avatar_url?: string }>(api, "/user");
    let repo: { default_branch: string; permissions?: { push?: boolean } };
    try {
      repo = await githubJson(api, `/repos/${repoPath(options.repo)}`);
    } catch (error) {
      if (error instanceof GitApiError && (error.status === 404 || error.status === 403)) {
        throw new SignInError("no-access", `The GitHub account ${user.login} can't see ${options.repo}.`);
      }
      throw error;
    }
    if (repo.permissions?.push === false) {
      throw new SignInError(
        "cant-publish",
        `The GitHub account ${user.login} can see ${options.repo} but can't publish to it.`,
      );
    }
    return new GitHubBackend({
      api,
      repo: options.repo,
      branch: options.branch ?? repo.default_branch,
      ...(options.contentOnly && { contentOnly: true }),
      user: { login: user.login, name: user.name ?? undefined, avatarUrl: user.avatar_url },
      onSignOut: () => storage.clear(),
      ownerTokenLink: { url: links.owner, label: "owner.token.create" },
      ...(service && {
        ownerRedirect: (redirectOptions?: RedirectOptions) => redirect("owner", false, redirectOptions),
      }),
    });
  }

  /** The repository through a token of the site's own, on a full-stack site's server. */
  function server({ token }: ServerGitOptions): ServerGit {
    const api: ApiOptions = { apiUrl, token: typeof token === "string" ? token : () => token(), fetch: fetcher };
    let branch: Promise<string> | undefined;
    const liveBranch = () => {
      branch ??= options.branch
        ? Promise.resolve(options.branch)
        : githubJson<{ default_branch: string }>(api, `/repos/${repoPath(options.repo)}`).then(
            (repo) => repo.default_branch,
          );
      // Asked again next time if GitHub couldn't be reached.
      branch.catch(() => {
        branch = undefined;
      });
      return branch;
    };
    const backend = async (revision?: string, author?: CommitAuthor) =>
      new GitHubBackend({
        api,
        repo: options.repo,
        branch: await liveBranch(),
        ...(options.contentOnly && { contentOnly: true }),
        user: { login: author?.name ?? options.repo, ...(author && { name: author.name }) },
        onSignOut: () => {},
        ownerTokenLink: { url: links.owner, label: "owner.token.create" },
        ...(revision && { revision }),
        ...(author && { author }),
      });
    return {
      ...(options.contentOnly && { contentOnly: true }),
      async revision() {
        return (await backend()).revision();
      },
      at: backend,
    };
  }

  return {
    name: "GitHub",
    canRedirect: service !== undefined,
    tokenLinks: [
      { url: links.fineGrained, label: "signIn.token.create" },
      { url: links.classic, label: "signIn.token.createBroad", hint: "signIn.token.createBroadHint" },
    ],
    async restore() {
      const redirected = await completeRedirect();
      if (redirected !== undefined) return redirected;
      return restoreSaved();
    },
    async signInWithToken(token, remember) {
      const trimmed = token.trim();
      if (!trimmed) throw new SignInError("invalid", "Paste a token to sign in.");
      const backend = await connect(trimmed);
      save({ type: "token", token: trimmed }, remember);
      return backend;
    },
    startRedirect(remember, redirectOptions) {
      return redirect("edit", remember, redirectOptions);
    },
    server,
  };
}
