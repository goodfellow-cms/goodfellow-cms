/**
 * What a connection is: who connected Claude and which sites it may work on.
 * The connector keeps none of it. It's sealed inside the tokens Claude holds,
 * so it can't be read or changed, and only a refresh token's generation is
 * stored (see `grants.ts`).
 */

export interface GitHubSite {
  id: string;
  repo: string;
  /** The Goodfellow for Claude app's installation the repository is in. */
  installation: number;
  branch: string;
}

export interface GitLabSite {
  id: string;
  repo: string;
  branch: string;
}

export interface BitbucketSite {
  id: string;
  repo: string;
}

export type Connection =
  | { host: "github"; user: { login: string; id: number; name?: string }; sites: GitHubSite[] }
  | { host: "gitlab"; user: { login: string; name?: string }; sites: GitLabSite[] }
  | { host: "bitbucket"; user: { login: string; name?: string }; sites: BitbucketSite[] };

/**
 * The person's GitLab or Bitbucket tokens, since those hosts have no app
 * tokens: sealed in Claude's tokens, never stored.
 */
export interface HostTokens {
  access: string;
  refresh: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** The most sites one connection may have, which keeps its tokens short. */
export const MAX_SITES = 20;
