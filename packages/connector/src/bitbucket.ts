/**
 * Bitbucket through an OAuth consumer. Bitbucket has no app tokens for one
 * repository, so the connector works with the person's own token, as with
 * GitLab: sealed inside the tokens Claude holds, never stored, and renewed when
 * Claude renews its own. The consumer is private (it has a secret), so it can
 * use the code grant, which gives a refresh token, where the admin panel can
 * only use the implicit grant.
 */
import { BITBUCKET_API, BITBUCKET_WEB, BitbucketBackend } from "@goodfellow-cms/bitbucket";
import { type BitbucketSite, type HostTokens, MAX_SITES } from "./connection.js";

export interface BitbucketConfig {
  /** The OAuth consumer's key and secret. */
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
}

/** Bitbucket answered with an error. */
export class BitbucketError extends Error {
  override name = "BitbucketError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The most workspaces whose repositories are listed, which keeps a sign-in within Workers' subrequests. */
const MAX_WORKSPACES = 10;

/** Bitbucket sends the person back to the consumer's callback URL, so none is named here. */
export function authorizeUrl(config: BitbucketConfig, state: string): string {
  return `${BITBUCKET_WEB}/site/oauth2/authorize?${new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    state,
  })}`;
}

async function tokenRequest(config: BitbucketConfig, params: Record<string, string>, now: number): Promise<HostTokens> {
  let response: Response;
  try {
    response = await config.fetch(`${BITBUCKET_WEB}/site/oauth2/access_token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(params),
    });
  } catch (error) {
    throw new BitbucketError(0, `Couldn't reach Bitbucket: ${(error as Error).message}`);
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new BitbucketError(response.status, `Bitbucket didn't accept the sign-in: ${body.error ?? response.status}`);
  }
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expiresAt: now + (body.expires_in ?? 7200) * 1000,
  };
}

export function exchangeCode(config: BitbucketConfig, code: string, now: number): Promise<HostTokens> {
  return tokenRequest(config, { grant_type: "authorization_code", code }, now);
}

export function refreshTokens(config: BitbucketConfig, refresh: string, now: number): Promise<HostTokens> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refresh }, now);
}

async function bitbucketJson<T>(config: BitbucketConfig, token: string, path: string): Promise<T> {
  const response = await config.fetch(`${BITBUCKET_API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new BitbucketError(response.status, `Bitbucket answered ${response.status}`);
  return (await response.json()) as T;
}

interface Page<T> {
  values: T[];
}

/** Who signed in, and the repositories they can publish to in their workspaces. */
export async function signedInSites(config: BitbucketConfig, token: string) {
  const user = await bitbucketJson<{ username?: string; nickname?: string; display_name?: string }>(
    config,
    token,
    "/user",
  );
  const login = user.username ?? user.nickname ?? "";
  const workspaces = await bitbucketJson<Page<{ workspace: { slug: string } }>>(
    config,
    token,
    "/user/workspaces?pagelen=100",
  );
  const sites: BitbucketSite[] = [];
  for (const { workspace } of workspaces.values.slice(0, MAX_WORKSPACES)) {
    const query = new URLSearchParams({ pagelen: "100", q: 'permission = "write" OR permission = "admin"' });
    const permissions = await bitbucketJson<
      Page<{ permission: "read" | "write" | "admin"; repository: { full_name: string } }>
    >(config, token, `/user/workspaces/${encodeURIComponent(workspace.slug)}/permissions/repositories?${query}`);
    for (const { permission, repository } of permissions.values) {
      if (permission === "read" || sites.some((site) => site.repo === repository.full_name)) continue;
      sites.push({ id: `bitbucket:${repository.full_name}`, repo: repository.full_name });
    }
  }
  return {
    user: { login, ...(user.display_name && { name: user.display_name }) },
    sites: sites.slice(0, MAX_SITES * 5),
  };
}

/** The site's backend, on the branch Bitbucket says is the repository's main one. */
export async function bitbucketBackend(
  config: BitbucketConfig,
  site: BitbucketSite,
  user: { login: string; name?: string },
  token: string,
): Promise<BitbucketBackend> {
  const repository = await bitbucketJson<{ mainbranch?: { name?: string } }>(
    config,
    token,
    `/repositories/${site.repo}`,
  );
  return new BitbucketBackend({
    api: { apiUrl: BITBUCKET_API, authorization: async () => `Bearer ${token}`, fetch: config.fetch },
    repo: site.repo,
    branch: repository.mainbranch?.name ?? "main",
    user: { login: user.login, ...(user.name && { name: user.name }) },
    onSignOut: () => {},
  });
}
