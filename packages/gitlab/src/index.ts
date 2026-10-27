import {
  type CommitAuthor,
  credentialStorage,
  GitApiError,
  type GitHost,
  hostSource,
  type ServerGit,
  type ServerGitOptions,
  SignInError,
  type StorageLike,
  withRateLimits,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson } from "./api.js";
import { GitLabBackend } from "./backend.js";
import { codeChallenge, type OAuthTokens, randomString, redirectUri, type TokenResponse, toTokens } from "./oauth.js";
import { gitlabSetup } from "./setup.js";

export { GitLabBackend } from "./backend.js";
export { redirectUri } from "./oauth.js";
export { gitlabPagesRecords } from "./pages.js";
export { type GitLabSetupOptions, gitlabSetup } from "./setup.js";

/** The page's address and how to change it. Replaceable in tests. */
export interface BrowserLocation {
  href(): string;
  /** Navigates away, for example to GitLab's sign-in page. */
  assign(url: string): void;
  /** Changes the address without reloading, for example to remove `?code=…` after signing in. */
  replace(url: string): void;
}

export interface GitLabOptions {
  /** The site's project path, such as `group/site` or `group/subgroup/site`. */
  project: string;
  /** The branch the live site is built from. Defaults to the project's default branch. */
  branch?: string;
  /** For self-managed GitLab. Defaults to `https://gitlab.com`. */
  url?: string;
  /**
   * The Application ID of an OAuth application registered for the site (not
   * confidential, scope `api`, redirect URI `https://your-site/admin/`). Enables
   * one-click "Sign in with GitLab". Without it, people sign in with a token.
   */
  clientId?: string;
  /**
   * The project holds only the site's content (`content/` and
   * `public/media/`), and its code is in a project of its own. The admin
   * panel then leaves adding blocks, which changes code, to a developer.
   */
  contentOnly?: boolean;
  /**
   * With `contentOnly`, the project the site's code is kept in, where its
   * updates run: the Updates screen follows them, for people who can see it.
   */
  code?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  storage?: { local?: StorageLike; session?: StorageLike };
  /** For tests. */
  location?: BrowserLocation;
}

type Credentials = { type: "token"; token: string } | OAuthTokens;

interface PendingRedirect {
  state: string;
  verifier: string;
  remember: boolean;
  /** The admin screen to return to. */
  hash: string;
}

const MIN_ACCESS_LEVEL_TO_PUBLISH = 30; // Developer

function browserLocation(): BrowserLocation {
  return {
    href: () => window.location.href,
    assign: (url) => window.location.assign(url),
    replace: (url) => window.history.replaceState(window.history.state, "", url),
  };
}

/** Sign-in and storage for a site whose repository is on GitLab. */
export function gitlab(options: GitLabOptions): GitHost {
  const webUrl = (options.url ?? "https://gitlab.com").replace(/\/$/, "");
  const apiUrl = `${webUrl}/api/v4`;
  // Many changes in a row, such as Claude's, can reach the host's limits: wait for them rather than fail.
  const fetcher: typeof fetch = withRateLimits(options.fetch ?? ((input, init) => globalThis.fetch(input, init)), {
    host: "GitLab",
  });
  const storage = credentialStorage(`goodfellow:gitlab:${webUrl}:${options.project}`, options.storage);
  const pending = credentialStorage(`goodfellow:gitlab:pending:${options.project}`, options.storage);
  const location = () => options.location ?? browserLocation();

  async function requestTokens(params: Record<string, string>): Promise<TokenResponse> {
    const response = await fetcher(`${webUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    if (!response.ok) throw new SignInError("invalid", `GitLab didn't accept the sign-in (${response.status}).`);
    return (await response.json()) as TokenResponse;
  }

  async function connect(initial: Credentials, remember: boolean): Promise<GitLabBackend> {
    let credentials = initial;
    const token: ApiOptions["token"] = async ({ refresh } = {}) => {
      if (credentials.type === "token") return credentials.token;
      if (refresh || credentials.expiresAt - 60_000 < Date.now()) {
        const { verifier } = credentials;
        const response = await requestTokens({
          client_id: options.clientId ?? "",
          refresh_token: credentials.refresh,
          grant_type: "refresh_token",
          redirect_uri: redirectUri(location().href()),
          code_verifier: verifier,
        });
        credentials = toTokens(response, verifier);
        storage.save(JSON.stringify(credentials), remember);
      }
      return credentials.access;
    };
    const api: ApiOptions = { apiUrl, token, canRefresh: credentials.type === "oauth", fetch: fetcher };

    const user = await gitlabJson<{ username: string; name?: string; avatar_url?: string }>(api, "/user");
    let project: {
      default_branch: string;
      permissions?: {
        project_access?: { access_level: number } | null;
        group_access?: { access_level: number } | null;
      };
    };
    try {
      project = await gitlabJson(api, `/projects/${encodeURIComponent(options.project)}`);
    } catch (error) {
      if (error instanceof GitApiError && (error.status === 404 || error.status === 403)) {
        throw new SignInError("no-access", `The GitLab account ${user.username} can't see ${options.project}.`);
      }
      throw error;
    }
    const access = Math.max(
      project.permissions?.project_access?.access_level ?? 0,
      project.permissions?.group_access?.access_level ?? 0,
    );
    if (access < MIN_ACCESS_LEVEL_TO_PUBLISH) {
      throw new SignInError(
        "cant-publish",
        `The GitLab account ${user.username} can see ${options.project} but can't publish to it.`,
      );
    }
    storage.save(JSON.stringify(credentials), remember);
    return new GitLabBackend({
      api,
      project: options.project,
      branch: options.branch ?? project.default_branch,
      ...(options.contentOnly && { contentOnly: true }),
      ...(options.contentOnly && options.code && { code: { project: options.code, webUrl } }),
      user: { login: user.username, name: user.name, avatarUrl: user.avatar_url },
      onSignOut: () => storage.clear(),
    });
  }

  /** Finishes a redirect sign-in if the page has just come back from GitLab. */
  async function completeRedirect(): Promise<GitLabBackend | null> {
    const url = new URL(location().href());
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (!code && !error) return null;
    const saved = pending.load();
    if (!saved) return null;
    pending.clear();
    const redirect = JSON.parse(saved) as PendingRedirect;

    // Remove the sign-in details from the address bar and return to the screen sign-in started from.
    for (const key of ["code", "state", "error", "error_description"]) url.searchParams.delete(key);
    url.hash = redirect.hash;
    location().replace(url.toString());

    // The state must match, so another site can't complete a sign-in it started.
    if (error || !code || returnedState !== redirect.state) {
      throw new SignInError("redirect-failed", "Signing in with GitLab was cancelled or didn't finish.");
    }
    const tokens = await requestTokens({
      client_id: options.clientId ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(url.toString()),
      code_verifier: redirect.verifier,
    });
    return connect(toTokens(tokens, redirect.verifier), redirect.remember);
  }

  /** The project through a token of the site's own, such as a project access token, on a full-stack site's server. */
  function server({ token }: ServerGitOptions): ServerGit {
    const api: ApiOptions = {
      apiUrl,
      token: async () => (typeof token === "string" ? token : token()),
      canRefresh: false,
      fetch: fetcher,
    };
    let branch: Promise<string> | undefined;
    const liveBranch = () => {
      branch ??= options.branch
        ? Promise.resolve(options.branch)
        : gitlabJson<{ default_branch: string }>(api, `/projects/${encodeURIComponent(options.project)}`).then(
            (project) => project.default_branch,
          );
      // Asked again next time if GitLab couldn't be reached.
      branch.catch(() => {
        branch = undefined;
      });
      return branch;
    };
    const backend = async (revision?: string, author?: CommitAuthor) =>
      new GitLabBackend({
        api,
        project: options.project,
        branch: await liveBranch(),
        ...(options.contentOnly && { contentOnly: true }),
        user: { login: author?.name ?? options.project, ...(author && { name: author.name }) },
        onSignOut: () => {},
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
    name: "GitLab",
    source: hostSource("@goodfellow-cms/gitlab", "gitlab", options, ["fetch", "storage", "location"]),
    canRedirect: Boolean(options.clientId),
    // With a token only, so its sign-in never meets the admin panel's own coming back from GitLab.
    setup: () =>
      gitlabSetup({
        ...(options.url && { url: options.url }),
        ...(options.fetch && { fetch: options.fetch }),
        ...(options.storage && { storage: options.storage }),
        ...(options.location && { location: options.location }),
      }),
    redirectAddressesListed: Boolean(options.clientId),
    tokenLinks: [
      {
        url: `${webUrl}/-/user_settings/personal_access_tokens?${new URLSearchParams({ name: "Goodfellow admin", scopes: "api" })}`,
        label: "signIn.token.create",
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
      return connect({ type: "token", token: trimmed }, remember);
    },
    async startRedirect(remember) {
      if (!options.clientId) throw new Error("gitlab({ clientId }) is needed to sign in with GitLab.");
      const verifier = randomString(48);
      const state = randomString(16);
      const here = new URL(location().href());
      const redirect: PendingRedirect = { state, verifier, remember, hash: here.hash };
      pending.save(JSON.stringify(redirect), false);
      const query = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri(here.toString()),
        response_type: "code",
        state,
        scope: "api",
        code_challenge: await codeChallenge(verifier),
        code_challenge_method: "S256",
      });
      location().assign(`${webUrl}/oauth/authorize?${query}`);
    },
    server,
  };
}
