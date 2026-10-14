/**
 * GitLab through an OAuth application. GitLab has no app tokens for one
 * project, so the connector works with the person's own token, as the admin
 * panel does: sealed inside the tokens Claude holds, never stored, and renewed
 * when Claude renews its own.
 */
import { GitLabBackend } from "@goodfellow-cms/gitlab";
import { type GitLabSite, type GitLabTokens, MAX_SITES } from "./connection.js";

export interface GitLabConfig {
  /** Such as `https://gitlab.com`. */
  url: string;
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
}

/** GitLab answered with an error. */
export class GitLabError extends Error {
  override name = "GitLabError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Developer, the lowest role that can push. */
const DEVELOPER = 30;

export function authorizeUrl(config: GitLabConfig, redirectUri: string, state: string, challenge: string): string {
  return `${config.url}/oauth/authorize?${new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "api",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
}

async function tokenRequest(config: GitLabConfig, params: Record<string, string>, now: number): Promise<GitLabTokens> {
  let response: Response;
  try {
    response = await config.fetch(`${config.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
    });
  } catch (error) {
    throw new GitLabError(0, `Couldn't reach GitLab: ${(error as Error).message}`);
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new GitLabError(response.status, `GitLab didn't accept the sign-in: ${body.error ?? response.status}`);
  }
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expiresAt: now + (body.expires_in ?? 7200) * 1000,
  };
}

export function exchangeCode(
  config: GitLabConfig,
  grant: { code: string; redirectUri: string; verifier: string },
  now: number,
): Promise<GitLabTokens> {
  return tokenRequest(
    config,
    {
      grant_type: "authorization_code",
      code: grant.code,
      redirect_uri: grant.redirectUri,
      code_verifier: grant.verifier,
    },
    now,
  );
}

export function refreshTokens(
  config: GitLabConfig,
  refresh: string,
  redirectUri: string,
  now: number,
): Promise<GitLabTokens> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refresh, redirect_uri: redirectUri }, now);
}

async function gitlabJson<T>(config: GitLabConfig, token: string, path: string): Promise<T> {
  const response = await config.fetch(`${config.url}/api/v4${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new GitLabError(response.status, `GitLab answered ${response.status}`);
  return (await response.json()) as T;
}

/** Who signed in, and the projects they can push to, most recently active first. */
export async function signedInSites(config: GitLabConfig, token: string) {
  const user = await gitlabJson<{ username: string; name?: string }>(config, token, "/user");
  const projects = await gitlabJson<Array<{ path_with_namespace: string; default_branch?: string | null }>>(
    config,
    token,
    `/projects?${new URLSearchParams({
      membership: "true",
      min_access_level: String(DEVELOPER),
      simple: "true",
      order_by: "last_activity_at",
      per_page: "100",
    })}`,
  );
  const sites: GitLabSite[] = projects
    .filter((project) => project.default_branch)
    .map((project) => ({
      id: `gitlab:${project.path_with_namespace}`,
      repo: project.path_with_namespace,
      branch: project.default_branch as string,
    }));
  return {
    user: { login: user.username, ...(user.name && { name: user.name }) },
    sites: sites.slice(0, MAX_SITES * 5),
  };
}

export function gitlabBackend(
  config: GitLabConfig,
  site: GitLabSite,
  user: { login: string; name?: string },
  token: string,
): GitLabBackend {
  return new GitLabBackend({
    api: { apiUrl: `${config.url}/api/v4`, token: async () => token, canRefresh: false, fetch: config.fetch },
    project: site.repo,
    branch: site.branch,
    user: { login: user.login, ...(user.name && { name: user.name }) },
    onSignOut: () => {},
  });
}
