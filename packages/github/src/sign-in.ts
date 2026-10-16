/**
 * Talking to the sign-in worker (`@goodfellow-cms/worker`), which signs
 * editors in with GitHub and gives the admin panel a token for the site's
 * repository, lasting an hour. Requests are sent as plain text, so browsers
 * send them straight away without asking the worker first.
 */
import { SignInError, type SignInProblem } from "@goodfellow-cms/core";

/** The sign-in worker Goodfellow runs for every site. Sites can run their own and name it in `github({ signIn })`. */
export const GOODFELLOW_SIGN_IN = "https://sign-in.goodfellow-cms.workers.dev";

export type SignInPurpose = "edit" | "owner" | "setup";

/** The person signed in, as the worker describes them. */
export interface SignInUser {
  login: string;
  name?: string;
  avatarUrl?: string;
  /** GitHub's private address for them, which commits name them by. */
  email: string;
}

export interface IssuedToken {
  token: string;
  /** ISO 8601. */
  expiresAt: string;
  /** The renewed session, which replaces the one sent. */
  session: string;
  user: SignInUser;
  /**
   * A token for the site's code repository, where its content is kept in a
   * repository of its own and the request named it: for reading its updates,
   * or for an owner's sign-in, running them. Absent where the worker can't
   * give one, such as where Goodfellow isn't installed on it.
   */
  code?: { token: string; expiresAt: string };
}

/** What the worker says when it can't help. */
export interface WorkerProblem {
  problem?: string;
  installUrl?: string;
}

/** The worker's problems, as the admin panel's sign-in problems. */
const PROBLEMS: Record<string, SignInProblem> = {
  invalid: "invalid",
  "no-access": "no-access",
  "cant-publish": "cant-publish",
  cancelled: "redirect-failed",
  "not-installed": "not-installed",
  "no-address": "no-address",
  "wrong-address": "wrong-address",
  "local-address": "local-address",
  "not-owner": "not-owner",
};

/** The worker's answer as a `SignInError`. */
export function signInProblem(answer: { problem?: unknown; installUrl?: unknown }): SignInError {
  const problem = PROBLEMS[String(answer.problem)] ?? "unavailable";
  const link =
    typeof answer.installUrl === "string" && /^https:\/\//.test(answer.installUrl) ? answer.installUrl : undefined;
  return new SignInError(problem, `The sign-in service said: ${String(answer.problem ?? "no answer")}.`, link);
}

/** Addresses on the computer itself, which the worker never gives tokens to. */
export function isLocalAddress(href: string): boolean {
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A secret that never leaves this tab, and its hash, which the worker checks it against (PKCE's S256). */
export async function newVerifier(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** The page's address and how to change it. Replaceable in tests. */
export interface BrowserLocation {
  href(): string;
  /** Navigates away, for example to GitHub's sign-in page. */
  assign(url: string): void;
  /** Changes the address without reloading, for example to remove the sign-in's details after coming back. */
  replace(url: string): void;
}

export function browserLocation(): BrowserLocation | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    href: () => window.location.href,
    assign: (url) => window.location.assign(url),
    replace: (url) => window.history.replaceState(window.history.state, "", url),
  };
}

/** Query parameters the worker comes back with. */
export const GRANT_PARAM = "goodfellow_sign_in";
export const ERROR_PARAM = "goodfellow_sign_in_error";

export class SignInService {
  readonly url: string;
  private readonly fetcher: typeof fetch;

  constructor(url: string, fetcher: typeof fetch) {
    this.url = url.replace(/\/$/, "");
    this.fetcher = fetcher;
  }

  private async answer<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}${path}`, init);
    } catch (error) {
      throw new SignInError("unavailable", `Couldn't reach the sign-in service: ${(error as Error).message}`);
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw signInProblem(body);
    return body as T;
  }

  /** Posts JSON as plain text. */
  post<T>(path: string, body: unknown): Promise<T> {
    return this.answer<T>(path, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
    });
  }

  /** Posts JSON as plain text, and gives the answer whatever it is, for callers that explain problems of their own. */
  async postAnswer<T>(path: string, body: unknown): Promise<{ ok: boolean; body: Partial<T> & WorkerProblem }> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}${path}`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new SignInError("unavailable", `Couldn't reach the sign-in service: ${(error as Error).message}`);
    }
    return { ok: response.ok, body: (await response.json().catch(() => ({}))) as Partial<T> & WorkerProblem };
  }

  /** Whether the worker is set up and answering. Throws `SignInError` if it isn't. */
  async health(): Promise<void> {
    const answer = await this.answer<{ ok?: boolean }>("/health");
    if (answer.ok !== true) throw new SignInError("unavailable", "The sign-in service isn't set up.");
  }

  /** Whether this page can sign in to the repository through the worker. Throws `SignInError` if it can't. */
  async check(repo: string, purpose: "edit" | "owner"): Promise<void> {
    await this.answer(`/github/check?${new URLSearchParams({ repo, purpose })}`);
  }

  /** Where to send the browser to sign in, or with `install`, to install Goodfellow and sign in. */
  startUrl(options: {
    purpose: SignInPurpose;
    repo?: string;
    back: string;
    challenge: string;
    remember: boolean;
    install?: boolean;
  }) {
    const query = new URLSearchParams({
      purpose: options.purpose,
      ...(options.repo && { repo: options.repo }),
      return: options.back,
      challenge: options.challenge,
      remember: options.remember ? "1" : "0",
      ...(options.install && { install: "1" }),
    });
    return `${this.url}/github/start?${query}`;
  }

  /**
   * Exchanges the grant the worker came back with, and this tab's verifier,
   * for a session (and for a site, its first token, and with `code`, one for
   * its code repository).
   */
  session<T = IssuedToken>(grant: string, verifier: string, code?: string): Promise<T> {
    return this.post<T>("/github/session", { grant, verifier, ...(code && { code }) });
  }

  token(session: string, code?: string): Promise<IssuedToken> {
    return this.post("/github/token", { session, ...(code && { code }) });
  }
}

/** A token that renews itself through the worker before it expires, or when GitHub stops accepting it. */
export function renewingToken(
  service: SignInService,
  first: IssuedToken,
  onRenew: (issued: IssuedToken) => void,
  code?: string,
): {
  token: (options?: { refresh?: boolean }) => Promise<string>;
  /** The code repository's token, renewed with the site's. Throws `no-access` while the worker gives none. */
  codeToken: (options?: { refresh?: boolean }) => Promise<string>;
  current: () => IssuedToken;
} {
  let current = first;
  let renewing: Promise<IssuedToken> | undefined;
  async function token({ refresh = false } = {}) {
    if (refresh || Date.parse(current.expiresAt) - 5 * 60_000 < Date.now()) {
      renewing ??= service.token(current.session, code).finally(() => {
        renewing = undefined;
      });
      current = await renewing;
      onRenew(current);
    }
    return current.token;
  }
  return {
    current: () => current,
    token,
    async codeToken(options) {
      await token(options);
      if (!current.code)
        throw new SignInError("no-access", "The sign-in service gave no token for the code repository.");
      return current.code.token;
    },
  };
}
