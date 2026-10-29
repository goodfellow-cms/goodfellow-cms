import { GitApiError, SignInError } from "@goodfellow-cms/core";

export interface ApiOptions {
  /** The API root, `https://api.bitbucket.org/2.0`. */
  apiUrl: string;
  /** The `Authorization` header's value, asked for on each request. */
  authorization: () => Promise<string>;
  fetch: typeof fetch;
}

/** How a sign-in authenticates with Bitbucket's API. */
export type Credentials =
  /** A repository, project or workspace access token, sent as a bearer token. */
  | { type: "token"; token: string }
  /** An Atlassian account's API token, sent with the account's email address. */
  | { type: "api-token"; email: string; token: string }
  /** Bitbucket's own sign-in, which gives a token that lasts two hours and can't be renewed from a browser. */
  | { type: "oauth"; access: string; expiresAt: number };

/** The header Bitbucket expects for each kind of credentials. */
export function authorizationFor(credentials: Credentials): string {
  if (credentials.type === "api-token") return `Basic ${btoa(`${credentials.email}:${credentials.token}`)}`;
  return `Bearer ${credentials.type === "oauth" ? credentials.access : credentials.token}`;
}

/**
 * Reads what someone pasted: an API token with its account's email address in
 * front (`email:token`), as Bitbucket's API tokens need, or an access token.
 */
export function credentialsFrom(pasted: string): Credentials {
  const text = pasted.trim();
  const colon = text.indexOf(":");
  const email = text.slice(0, colon);
  if (colon > 0 && /^[^\s@:]+@[^\s@:]+$/.test(email)) return { type: "api-token", email, token: text.slice(colon + 1) };
  return { type: "token", token: text };
}

export interface RequestInit {
  method?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as `multipart/form-data`, as the `src` endpoint takes new files. */
  form?: FormData;
  /** Statuses that aren't errors here. */
  allow?: number[];
}

/** The text of an error Bitbucket gave, which it puts at `error.message`. */
async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: unknown }; message?: unknown };
  const message = body.error?.message ?? body.message;
  return typeof message === "string" ? message : "";
}

/** Calls Bitbucket's API. A 401 means the sign-in has expired or was never right. */
export async function bitbucketRequest(api: ApiOptions, path: string, init: RequestInit = {}): Promise<Response> {
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(path);
  // Addresses Bitbucket answers with, such as a list's next page, get the sign-in only on its API.
  if (absolute && !path.startsWith(`${api.apiUrl}/`)) {
    throw new GitApiError(0, "Bitbucket pointed to an address outside its API.");
  }
  const url = absolute ? path : `${api.apiUrl}${path}`;
  const response = await api.fetch(url, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers: {
      authorization: await api.authorization(),
      ...(init.body !== undefined && { "content-type": "application/json" }),
    },
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    cache: "no-store",
  });
  if (response.status === 401 && !init.allow?.includes(401)) {
    throw new SignInError("invalid", "Bitbucket didn't accept the sign-in. It may have expired.");
  }
  if (!response.ok && !init.allow?.includes(response.status)) {
    const message = await errorMessage(response);
    throw new GitApiError(response.status, `Bitbucket answered ${response.status}: ${message || response.statusText}`);
  }
  return response;
}

export async function bitbucketJson<T>(api: ApiOptions, path: string, init?: RequestInit): Promise<T> {
  return (await (await bitbucketRequest(api, path, init)).json()) as T;
}

/** One page of a list Bitbucket answers with, which links to the next. */
export interface Paged<T> {
  values: T[];
  next?: string;
}

/** Every item of a list, following its pages, up to `limit` pages. */
export async function allPages<T>(api: ApiOptions, path: string, limit = 20): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < limit; page++) {
    const found: Paged<T> = await bitbucketJson<Paged<T>>(api, next);
    items.push(...found.values);
    next = found.next;
  }
  return items;
}

/** A query for Bitbucket's filters (`q=`), with a value quoted as they need. */
export function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
