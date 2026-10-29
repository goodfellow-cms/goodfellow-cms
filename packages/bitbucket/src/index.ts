import {
  type CommitAuthor,
  credentialStorage,
  type GitHost,
  hostSource,
  type ServerGit,
  type ServerGitOptions,
  SignInError,
  type StorageLike,
  withRateLimits,
} from "@goodfellow-cms/core";
import {
  type ApiOptions,
  authorizationFor,
  bitbucketJson,
  bitbucketRequest,
  type Credentials,
  credentialsFrom,
  quoted,
} from "./api.js";
import { BitbucketBackend } from "./backend.js";
import type { Permission } from "./editors.js";
import { bitbucketSetup } from "./setup.js";
import { BITBUCKET_API, BITBUCKET_WEB } from "./web.js";

export { BitbucketBackend, encodePath } from "./backend.js";
export { type BitbucketSetupOptions, bitbucketSetup } from "./setup.js";
export { BITBUCKET_API, BITBUCKET_WEB } from "./web.js";

/** The page's address and how to change it. Replaceable in tests. */
export interface BrowserLocation {
  href(): string;
  /** Navigates away, for example to Bitbucket's sign-in page. */
  assign(url: string): void;
  /** Changes the address without reloading, for example to remove the token Bitbucket sent back. */
  replace(url: string): void;
}

export interface BitbucketOptions {
  /** The site's repository on Bitbucket Cloud: `workspace/repository`. */
  repo: string;
  /** The branch the live site is built from. Defaults to the repository's main branch. */
  branch?: string;
  /**
   * The Key of an OAuth consumer registered for the site in the workspace's
   * settings (callback URL `https://your-site/admin/`, permissions to write
   * repositories and pull requests and run pipelines, not private). Enables
   * one-click "Sign in with Bitbucket", which lasts two hours at a time.
   * Without it, people sign in with a token.
   */
  clientId?: string;
  /**
   * The repository holds only the site's content (`content/` and
   * `public/media/`), and its code is in a repository of its own. The admin
   * panel then leaves adding blocks, which changes code, to a developer.
   */
  contentOnly?: boolean;
  /** With `contentOnly`, the code's repository, `workspace/name`, whose updates the Updates screen follows. */
  code?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  storage?: { local?: StorageLike; session?: StorageLike };
  /** For tests. */
  location?: BrowserLocation;
}

interface PendingRedirect {
  state: string;
  remember: boolean;
  /** The admin screen to return to. */
  hash: string;
}

interface Repository {
  mainbranch?: { name: string };
}

interface Account {
  username?: string;
  nickname?: string;
  display_name?: string;
  links?: { avatar?: { href?: string } };
}

function browserLocation(): BrowserLocation {
  return {
    href: () => window.location.href,
    assign: (url) => window.location.assign(url),
    replace: (url) => window.history.replaceState(window.history.state, "", url),
  };
}

function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Sign-in and storage for a site whose repository is on Bitbucket Cloud. */
export function bitbucket(options: BitbucketOptions): GitHost {
  // Many changes in a row, such as Claude's, can reach the host's limits: wait for them rather than fail.
  const fetcher: typeof fetch = withRateLimits(options.fetch ?? ((input, init) => globalThis.fetch(input, init)), {
    host: "Bitbucket",
  });
  const storage = credentialStorage(`goodfellow:bitbucket:${options.repo}`, options.storage);
  const pending = credentialStorage(`goodfellow:bitbucket:pending:${options.repo}`, options.storage);
  const location = () => options.location ?? browserLocation();
  const [workspace = ""] = options.repo.split("/");

  async function connect(credentials: Credentials, remember: boolean): Promise<BitbucketBackend> {
    if (credentials.type === "oauth" && credentials.expiresAt < Date.now()) {
      throw new SignInError("invalid", "The Bitbucket sign-in has expired.");
    }
    const api: ApiOptions = {
      apiUrl: BITBUCKET_API,
      authorization: async () => authorizationFor(credentials),
      fetch: fetcher,
    };
    const found = await bitbucketRequest(api, `/repositories/${options.repo}`, { allow: [403, 404] });
    if (!found.ok) throw new SignInError("no-access", `This Bitbucket sign-in can't see ${options.repo}.`);
    const repository = (await found.json()) as Repository;

    // Access tokens belong to no account, so Bitbucket can't say who they are.
    const me = await bitbucketRequest(api, "/user", { allow: [401, 403] });
    const account = me.ok ? ((await me.json()) as Account) : undefined;
    const login = account?.username ?? account?.nickname;
    let permission: Permission | undefined;
    if (login) {
      const query = new URLSearchParams({ q: `repository.full_name = ${quoted(options.repo)}` });
      permission = await bitbucketJson<{ values: Array<{ permission: Permission }> }>(
        api,
        `/user/workspaces/${workspace}/permissions/repositories?${query}`,
      ).then(
        (permissions) => permissions.values[0]?.permission,
        () => undefined,
      );
      if (permission === "read") {
        throw new SignInError(
          "cant-publish",
          `The Bitbucket account ${login} can see ${options.repo} but can't publish to it.`,
        );
      }
    }
    storage.save(JSON.stringify(credentials), remember);
    return new BitbucketBackend({
      api,
      repo: options.repo,
      branch: options.branch ?? repository.mainbranch?.name ?? "main",
      user: login
        ? { login, name: account?.display_name, avatarUrl: account?.links?.avatar?.href }
        : { login: "access-token", name: "Access token" },
      ...(permission && { permission }),
      ...(options.contentOnly && { contentOnly: true, ...(options.code && { code: options.code }) }),
      onSignOut: () => storage.clear(),
    });
  }

  /**
   * Finishes a redirect sign-in if the page has just come back from
   * Bitbucket, whose sign-in for browsers sends the token back in the
   * address's fragment, where the admin panel's screen usually is.
   */
  async function completeRedirect(): Promise<BitbucketBackend | null> {
    const url = new URL(location().href());
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const access = fragment.get("access_token");
    const error = fragment.get("error") ?? url.searchParams.get("error");
    if (!access && !error) return null;
    // Take the token out of the address bar, history and bookmarks first, even where this tab
    // didn't start the sign-in, and go back to the screen sign-in started from.
    for (const key of ["error", "error_description"]) url.searchParams.delete(key);
    const saved = pending.load();
    url.hash = saved ? (JSON.parse(saved) as PendingRedirect).hash : "";
    location().replace(url.toString());
    if (!saved) return null;
    pending.clear();
    const redirect = JSON.parse(saved) as PendingRedirect;

    // The state must match, so another site can't finish a sign-in it started.
    if (error || !access || fragment.get("state") !== redirect.state) {
      throw new SignInError("redirect-failed", "Signing in with Bitbucket was cancelled or didn't finish.");
    }
    const expiresIn = Number(fragment.get("expires_in") ?? 7200);
    const credentials: Credentials = {
      type: "oauth",
      access,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 7200) * 1000,
    };
    return connect(credentials, redirect.remember);
  }

  /** The repository through a token of the site's own, such as a repository access token, on a full-stack site's server. */
  function server({ token }: ServerGitOptions): ServerGit {
    const api: ApiOptions = {
      apiUrl: BITBUCKET_API,
      authorization: async () => authorizationFor(credentialsFrom(typeof token === "string" ? token : await token())),
      fetch: fetcher,
    };
    let branch: Promise<string> | undefined;
    const liveBranch = () => {
      branch ??= options.branch
        ? Promise.resolve(options.branch)
        : bitbucketJson<Repository>(api, `/repositories/${options.repo}`).then(
            (found) => found.mainbranch?.name ?? "main",
          );
      // Asked again next time if Bitbucket couldn't be reached.
      branch.catch(() => {
        branch = undefined;
      });
      return branch;
    };
    const backend = async (revision?: string, author?: CommitAuthor) =>
      new BitbucketBackend({
        api,
        repo: options.repo,
        branch: await liveBranch(),
        ...(options.contentOnly && { contentOnly: true, ...(options.code && { code: options.code }) }),
        user: { login: author?.name ?? options.repo, ...(author && { name: author.name }) },
        onSignOut: () => {},
        ...(revision && { revision }),
        ...(author && { author }),
      });
    return {
      ...(options.contentOnly && { contentOnly: true, ...(options.code && { code: options.code }) }),
      async revision() {
        return (await backend()).revision();
      },
      at: backend,
    };
  }

  return {
    name: "Bitbucket",
    source: hostSource("@goodfellow-cms/bitbucket", "bitbucket", options, ["fetch", "storage", "location"]),
    canRedirect: Boolean(options.clientId),
    // The OAuth consumer's callback URL is listed in Bitbucket, so a new domain must be added there.
    redirectAddressesListed: Boolean(options.clientId),
    setup: () => bitbucketSetup({ ...(options.fetch && { fetch: options.fetch }) }),
    tokenLinks: [
      { url: `${BITBUCKET_WEB}/${options.repo}/admin/access-tokens`, label: "signIn.token.create" },
      {
        url: "https://id.atlassian.com/manage-profile/security/api-tokens",
        label: "signIn.token.createBroad",
        hint: "signIn.token.apiTokenHint",
      },
    ],
    async restore() {
      const redirected = await completeRedirect();
      if (redirected) return redirected;
      const saved = storage.load();
      if (!saved) return null;
      try {
        return await connect(JSON.parse(saved) as Credentials, storage.remembered());
      } catch (error) {
        if (error instanceof SignInError) storage.clear();
        throw error;
      }
    },
    async signInWithToken(token, remember) {
      const trimmed = token.trim();
      if (!trimmed) throw new SignInError("invalid", "Paste a token to sign in.");
      return connect(credentialsFrom(trimmed), remember);
    },
    async startRedirect(remember) {
      if (!options.clientId) throw new Error("bitbucket({ clientId }) is needed to sign in with Bitbucket.");
      const state = randomState();
      const here = new URL(location().href());
      const redirect: PendingRedirect = { state, remember, hash: here.hash };
      pending.save(JSON.stringify(redirect), false);
      const query = new URLSearchParams({ client_id: options.clientId, response_type: "token", state });
      location().assign(`${BITBUCKET_WEB}/site/oauth2/authorize?${query}`);
    },
    server,
  };
}
