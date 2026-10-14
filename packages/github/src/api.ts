import { GitApiError, SignInError } from "@goodfellow-cms/core";

/** A token that renews itself, such as one from the sign-in worker. `refresh` asks for a new one even if it hasn't expired. */
export type TokenSource = (options?: { refresh?: boolean }) => Promise<string>;

export interface ApiOptions {
  apiUrl: string;
  token: string | TokenSource;
  fetch: typeof fetch;
}

/** Calls the GitHub REST or GraphQL API. Treats 401 as an expired sign-in; other errors become `GitApiError`. */
export async function githubRequest(
  { apiUrl, token, fetch }: ApiOptions,
  path: string,
  init: { method?: string; body?: unknown; accept?: string; allow?: number[] } = {},
): Promise<Response> {
  const send = async (refresh: boolean) =>
    fetch(`${apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: init.accept ?? "application/vnd.github+json",
        authorization: `Bearer ${typeof token === "string" ? token : await token({ refresh })}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body !== undefined && { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  let response = await send(false);
  // A token that renews itself may have been revoked or expired early: try once more with a new one.
  if (response.status === 401 && typeof token !== "string") response = await send(true);
  if (response.status === 401)
    throw new SignInError("invalid", "GitHub didn't accept the sign-in. It may have expired.");
  if (!response.ok && !init.allow?.includes(response.status)) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new GitApiError(
      response.status,
      `GitHub answered ${response.status}: ${body.message ?? response.statusText}`,
    );
  }
  return response;
}

export async function githubJson<T>(
  options: ApiOptions,
  path: string,
  init?: Parameters<typeof githubRequest>[2],
): Promise<T> {
  return (await (await githubRequest(options, path, init)).json()) as T;
}

/** Path segments of a repository name, encoded for URLs: `owner/name` stays `owner/name`. */
export function repoPath(repo: string): string {
  return repo
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}
