import {
  type CreatedSiteRepository,
  credentialStorage,
  encodeBase64Bytes,
  GitApiError,
  type NewSiteRepository,
  type RepositoryLink,
  type SetupAccount,
  SetupError,
  type SetupHost,
  type SetupOwner,
  type SetupWarning,
  SignInError,
  type StorageLike,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";
import type { BrowserLocation } from "./index.js";
import { codeChallenge, type OAuthTokens, randomString, redirectUri, type TokenResponse, toTokens } from "./oauth.js";
import { NIGHTLY } from "./updates.js";

export interface GitLabSetupOptions {
  /** For self-managed GitLab. Defaults to `https://gitlab.com`. */
  url?: string;
  /**
   * The Application ID of an OAuth application for the setup page (not
   * confidential, scope `api`, redirect URI the page's address). Enables
   * "Sign in with GitLab". Without it, people sign in with a token.
   */
  clientId?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  storage?: { local?: StorageLike; session?: StorageLike };
  /** For tests. */
  location?: BrowserLocation;
}

/** The branch the deploy setups build from. */
const MAIN = "main";

interface PendingRedirect {
  state: string;
  verifier: string;
}

function browserLocation(): BrowserLocation {
  return {
    href: () => window.location.href,
    assign: (url) => window.location.assign(url),
    replace: (url) => window.history.replaceState(window.history.state, "", url),
  };
}

/** Signing in to GitLab to create a site's project, with GitLab Pages if wanted. */
export function gitlabSetup(options: GitLabSetupOptions = {}): SetupHost {
  const webUrl = (options.url ?? "https://gitlab.com").replace(/\/$/, "");
  const apiUrl = `${webUrl}/api/v4`;
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  // Only what's needed to finish signing in is kept, and only until it's finished: tokens stay in memory.
  const pending = credentialStorage("goodfellow:gitlab-setup:pending", options.storage);
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

  async function connect(initial: { type: "token"; token: string } | OAuthTokens): Promise<SetupAccount> {
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
      }
      return credentials.access;
    };
    const api: ApiOptions = { apiUrl, token, canRefresh: credentials.type === "oauth", fetch: fetcher };
    const user = await gitlabJson<{ id: number; username: string; name?: string; avatar_url?: string }>(api, "/user");

    async function isAvailable(owner: SetupOwner, name: string): Promise<boolean> {
      const response = await gitlabRequest(api, `/projects/${encodeURIComponent(`${owner.path}/${name}`)}`, {
        allow: [404],
      });
      return response.status === 404;
    }

    /**
     * Lets each project's pipelines reach the other, as their setup files say:
     * a job token is refused by a project whose job token allowlist doesn't
     * name its project, even a public one. Also lets the code project's job
     * token publish updates, and runs pipelines each night where they need it.
     * Returns whether it worked.
     */
    async function connectProjects(link: RepositoryLink): Promise<boolean> {
      const project = (path: string) => `/projects/${encodeURIComponent(path)}`;
      try {
        const ids = new Map<string, number>();
        for (const which of ["code", "content"] as const) {
          ids.set(which, (await gitlabJson<{ id: number }>(api, project(link[which]))).id);
        }
        for (const { reader, read } of link.links.reads) {
          await gitlabRequest(api, `${project(link[read])}/job_token_scope/allowlist`, {
            method: "POST",
            body: { target_project_id: ids.get(reader) },
          });
        }
        if (link.links.updates) {
          await gitlabRequest(api, project(link[link.links.updates]), {
            method: "PUT",
            body: { ci_push_repository_for_job_token_allowed: true },
          });
        }
        for (const which of link.links.nightly) {
          await gitlabRequest(api, `${project(link[which])}/pipeline_schedules`, {
            method: "POST",
            body: {
              description:
                which === link.links.updates
                  ? "Rebuild the site and install Goodfellow's fixes each night"
                  : "Rebuild the site each night",
              ref: MAIN,
              cron: NIGHTLY,
              cron_timezone: "UTC",
              active: true,
            },
          });
        }
        return true;
      } catch (error) {
        if (error instanceof GitApiError && [400, 403, 404].includes(error.status)) return false;
        throw error;
      }
    }

    return {
      user: { login: user.username, name: user.name, avatarUrl: user.avatar_url },
      async owners() {
        const namespaces = await gitlabJson<{ id: number; kind: string; full_path: string; name: string }[]>(
          api,
          "/namespaces?per_page=100",
        );
        const owners = namespaces.map(
          (namespace): SetupOwner => ({
            path: namespace.full_path,
            name: namespace.kind === "user" ? (user.name ?? namespace.name) : namespace.name,
            kind: namespace.kind === "user" ? "personal" : "organization",
            id: namespace.id,
          }),
        );
        return [...owners.filter((owner) => owner.kind === "personal"), ...owners.filter((o) => o.kind !== "personal")];
      },
      isAvailable,
      async createSite(site: NewSiteRepository, onStep): Promise<CreatedSiteRepository> {
        onStep?.("repository");
        if (!(await isAvailable(site.owner, site.name))) {
          throw new SetupError("name-taken", `There's already a project called ${site.owner.path}/${site.name}.`);
        }
        let project: { id: number; path_with_namespace: string; web_url: string };
        try {
          project = await gitlabJson(api, "/projects", {
            method: "POST",
            body: {
              name: site.name,
              path: site.name,
              namespace_id: site.owner.id,
              visibility: site.private ? "private" : "public",
              description: site.description,
              // A private project's Pages are only for its members unless they're made public.
              ...(site.pages && { pages_access_level: site.private ? "public" : "enabled" }),
            },
          });
        } catch (error) {
          if (error instanceof GitApiError && error.status === 400) {
            throw new SetupError("name-invalid", `GitLab can't use "${site.name}" as a project name.`);
          }
          if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
            throw new SetupError("not-allowed", `This sign-in can't create projects in ${site.owner.path}.`);
          }
          throw error;
        }
        const warnings: SetupWarning[] = [];
        if (site.link) {
          onStep?.("connect");
          if (!(await connectProjects(site.link))) warnings.push("connect-unavailable");
        }
        // GitLab Pages needs no setting of its own: the site's .gitlab-ci.yml publishes it on every change.
        onStep?.("files");
        await gitlabRequest(api, `/projects/${project.id}/repository/commits`, {
          method: "POST",
          body: {
            branch: MAIN,
            commit_message: site.message,
            actions: site.files.flatMap((file) =>
              "delete" in file
                ? []
                : "content" in file
                  ? [{ action: "create", file_path: file.path, content: file.content }]
                  : [
                      {
                        action: "create",
                        file_path: file.path,
                        content: encodeBase64Bytes(file.bytes),
                        encoding: "base64",
                      },
                    ],
            ),
          },
        });
        // GitLab protects a project's default branch from having its history rewritten from the start.
        return {
          repo: project.path_with_namespace,
          webUrl: project.web_url,
          buildsUrl: `${project.web_url}/-/pipelines`,
          pagesUrl: site.pages ? `${project.web_url}/pages` : undefined,
          warnings,
        };
      },
    };
  }

  return {
    name: "GitLab",
    canRedirect: Boolean(options.clientId),
    tokenLinks: [
      {
        url: `${webUrl}/-/user_settings/personal_access_tokens?${new URLSearchParams({ name: "Goodfellow site setup", scopes: "api" })}`,
        label: "signIn.token.create",
      },
    ],
    async restore() {
      const url = new URL(location().href());
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (!code && !error) return null;
      const saved = pending.load();
      if (!saved) return null;
      pending.clear();
      const redirect = JSON.parse(saved) as PendingRedirect;
      const returnedState = url.searchParams.get("state");
      for (const key of ["code", "state", "error", "error_description"]) url.searchParams.delete(key);
      location().replace(url.toString());
      // The state must match, so another site can't finish a sign-in it started.
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
      return connect(toTokens(tokens, redirect.verifier));
    },
    async signInWithToken(token) {
      const trimmed = token.trim();
      if (!trimmed) throw new SignInError("invalid", "Paste a token to sign in.");
      return connect({ type: "token", token: trimmed });
    },
    async startRedirect() {
      if (!options.clientId) throw new Error("gitlabSetup({ clientId }) is needed to sign in with GitLab.");
      const redirect: PendingRedirect = { state: randomString(16), verifier: randomString(48) };
      pending.save(JSON.stringify(redirect), false);
      const query = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri(location().href()),
        response_type: "code",
        state: redirect.state,
        scope: "api",
        code_challenge: await codeChallenge(redirect.verifier),
        code_challenge_method: "S256",
      });
      location().assign(`${webUrl}/oauth/authorize?${query}`);
    },
  };
}
