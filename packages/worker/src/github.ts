/** The GitHub calls the worker makes: as an app, as the signed-in person, and with OAuth's client secret. */

export interface GitHubConfig {
  api: string;
  web: string;
  fetch: typeof fetch;
}

/** A GitHub App the worker signs people in with. */
export interface App {
  id: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
}

/** GitHub answered with an error. `status` is GitHub's, or 0 if it couldn't be reached. */
export class GitHubError extends Error {
  override name = "GitHubError";
  constructor(
    readonly status: number,
    message: string,
    readonly body: { message?: string; errors?: Array<{ message?: string }> } = {},
  ) {
    super(message);
  }
}

export type Auth = { bearer: string } | { basic: [string, string] } | undefined;

export async function github(
  config: GitHubConfig,
  path: string,
  init: { auth?: Auth; method?: string; body?: unknown; accept?: string; web?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: init.accept ?? (init.web ? "application/json" : "application/vnd.github+json"),
    "user-agent": "goodfellow-sign-in",
  };
  if (!init.web) headers["x-github-api-version"] = "2022-11-28";
  if (init.auth && "bearer" in init.auth) headers.authorization = `Bearer ${init.auth.bearer}`;
  if (init.auth && "basic" in init.auth) headers.authorization = `Basic ${btoa(init.auth.basic.join(":"))}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await config.fetch(`${init.web ? config.web : config.api}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new GitHubError(0, `Couldn't reach GitHub: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GitHubError["body"];
    throw new GitHubError(response.status, `GitHub answered ${response.status}: ${body.message ?? ""}`, body);
  }
  return response;
}

export async function githubJson<T>(config: GitHubConfig, path: string, init?: Parameters<typeof github>[2]) {
  return (await (await github(config, path, init)).json()) as T;
}

export function repoPath(repo: string): string {
  return repo.split("/").map(encodeURIComponent).join("/");
}

/** A GitHub person's own access, from signing in with an app: GitHub's user access token and its refresh token. */
export interface UserTokens {
  access: string;
  refresh?: string;
  /** Milliseconds since the epoch. */
  accessExpires?: number;
  refreshExpires?: number;
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchanges OAuth's code, or a refresh token, for the person's tokens. GitHub answers 200 even when it refuses. */
export async function userTokens(
  config: GitHubConfig,
  app: App,
  grant: { code: string; redirectUri: string } | { refresh: string },
  now: number,
): Promise<UserTokens> {
  const answer = await githubJson<TokenAnswer>(config, "/login/oauth/access_token", {
    web: true,
    method: "POST",
    body: {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...("code" in grant
        ? { code: grant.code, redirect_uri: grant.redirectUri }
        : { grant_type: "refresh_token", refresh_token: grant.refresh }),
    },
  });
  if (!answer.access_token) {
    throw new GitHubError(401, `GitHub didn't accept the sign-in: ${answer.error_description ?? answer.error ?? ""}`);
  }
  return {
    access: answer.access_token,
    refresh: answer.refresh_token,
    accessExpires: answer.expires_in ? now + answer.expires_in * 1000 : undefined,
    refreshExpires: answer.refresh_token_expires_in ? now + answer.refresh_token_expires_in * 1000 : undefined,
  };
}

/** Revokes a person's user access token, as signing out does. */
export async function revokeUserToken(config: GitHubConfig, app: App, token: string): Promise<void> {
  await github(config, `/applications/${encodeURIComponent(app.clientId)}/token`, {
    method: "DELETE",
    auth: { basic: [app.clientId, app.clientSecret] },
    body: { access_token: token },
  });
}

/** The permissions a token can be given, as GitHub names them. */
export type Permissions = Record<string, "read" | "write">;

export interface InstallationToken {
  token: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** A token for one repository, with only these permissions, lasting an hour. */
export async function installationToken(
  config: GitHubConfig,
  jwt: string,
  installation: number,
  repo: string,
  permissions: Permissions,
): Promise<InstallationToken> {
  const answer = await githubJson<{ token: string; expires_at: string }>(
    config,
    `/app/installations/${installation}/access_tokens`,
    {
      method: "POST",
      auth: { bearer: jwt },
      body: { repositories: [repo.split("/")[1] ?? ""], permissions },
    },
  );
  return { token: answer.token, expiresAt: answer.expires_at };
}
