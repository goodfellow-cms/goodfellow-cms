/**
 * How editors sign in, as `goodfellow.config.tsx`'s backend line says: a
 * GitHub site's sign-in service (`github({ signIn })`), and a GitLab site's
 * OAuth application or a Bitbucket site's OAuth consumer (`clientId`). The
 * admin panel's Security tab and `goodfellow sign-in` change them with
 * `withBackendOption()`, which edits the options of the `backend:` call where
 * they're written plainly, keeping the rest of the file as it is.
 */

export type ConfigBackendHost = "github" | "gitlab" | "bitbucket";

/** The options of the backend's call that sign-in uses, each a string. */
export type SignInOption = "signIn" | "clientId";

/** A `backend: host({ … })` call whose options hold no nested objects, across lines or not. */
const BACKEND_CALL = /^([ \t]*)backend:\s*(github|gitlab|bitbucket)\(\{([^{}]*)\}\)/m;

function optionPattern(key: string): RegExp {
  return new RegExp(`(^|[{,\\s])${key}\\s*:\\s*("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')`);
}

/** The git host the config's backend line names, or `undefined` without one. */
export function configBackendHost(source: string): ConfigBackendHost | undefined {
  return BACKEND_CALL.exec(source)?.[2] as ConfigBackendHost | undefined;
}

/** An option the config's backend line sets as a plain string, such as `signIn: "https://…"` or `project: "…"`. */
export function configBackendOption(source: string, key: string): string | undefined {
  const options = BACKEND_CALL.exec(source)?.[3];
  const match = options ? optionPattern(key).exec(options) : undefined;
  if (!match?.[2]) return undefined;
  const quoted = match[2];
  return quoted.startsWith('"') ? (JSON.parse(quoted) as string) : quoted.slice(1, -1).replace(/\\(.)/g, "$1");
}

/**
 * `goodfellow.config.tsx` with the backend's `key` option set to `value`, or
 * taken out; `undefined` where the file has no `backend:` call whose options
 * it can change safely (none, or one with objects inside it), which a
 * developer then changes by hand.
 */
export function withBackendOption(source: string, key: SignInOption, value: string | undefined): string | undefined {
  const call = BACKEND_CALL.exec(source);
  if (!call) return undefined;
  const [whole, indent = "", host, options = ""] = call;
  const pattern = optionPattern(key);
  const found = pattern.exec(options);
  let next: string;
  if (found) {
    if (value === undefined) {
      // The option and the comma before it (or after it, when it's first).
      const start = found.index + (found[1] ?? "").length;
      const end = start + found[0].length - (found[1] ?? "").length;
      const before = options.slice(0, start).replace(/,\s*$/, "");
      const after = options.slice(end);
      next = before.trim() ? `${before}${after}` : after.replace(/^\s*,\s*/, " ");
    } else {
      next = options.replace(pattern, (_, lead: string) => `${lead}${key}: ${JSON.stringify(value)}`);
    }
  } else {
    if (value === undefined) return source;
    const entry = `${key}: ${JSON.stringify(value)}`;
    if (options.includes("\n")) {
      // One option a line: the new one goes last, indented as the others are.
      const lines = options.replace(/\s*$/, "");
      const lineIndent = /\n([ \t]+)\S/.exec(options)?.[1] ?? `${indent}  `;
      const comma = lines.trimEnd().endsWith(",") ? "" : ",";
      next = `${lines}${comma}\n${lineIndent}${entry},\n${indent}`;
    } else {
      const trimmed = options.trim().replace(/,$/, "");
      next = trimmed ? ` ${trimmed}, ${entry} ` : ` ${entry} `;
    }
  }
  const replaced = `${indent}backend: ${host}({${next}})`;
  return source.replace(whole, replaced);
}

/**
 * Why `url` can't be a sign-in service's address: it needs to be `https://`,
 * with nothing after the domain, and not this computer's.
 */
export function signInServiceProblem(url: string): "invalid" | undefined {
  try {
    const parsed = new URL(url.trim());
    const local =
      /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(parsed.hostname) || parsed.hostname.endsWith(".localhost");
    if (parsed.protocol !== "https:" || local || parsed.search || parsed.hash) return "invalid";
    if (parsed.pathname !== "/" && parsed.pathname !== "") return "invalid";
    return undefined;
  } catch {
    return "invalid";
  }
}

/** Why `id` can't be a GitLab application's ID or a Bitbucket consumer's Key: letters, numbers, `.`, `_` and `-`. */
export function signInClientIdProblem(id: string): "invalid" | undefined {
  return /^[A-Za-z0-9._-]{8,128}$/.test(id.trim()) ? undefined : "invalid";
}

/**
 * The addresses a GitLab application's redirect URIs or a Bitbucket consumer's
 * callback URL need: the admin panel at the Site address and at the admin
 * address where there is one, each with its trailing slash, as the backends
 * send them (`redirectUri()`), and the token broker's, which signs in itself.
 */
export function signInRedirectAddresses(
  siteUrl: string | undefined,
  { admin, broker }: { admin?: string; broker?: string } = {},
): string[] {
  const addresses: string[] = [];
  let path = "";
  try {
    if (siteUrl) {
      const url = new URL(siteUrl);
      path = url.pathname.replace(/\/$/, "");
      addresses.push(`${url.origin}${path}/admin/`);
    }
  } catch {
    // A Site address that isn't one is the site checks' to report.
  }
  for (const [address, suffix] of [
    [admin, `${path}/admin/`],
    [broker, "/"],
  ] as const) {
    try {
      if (address) addresses.push(`${new URL(address).origin}${suffix}`);
    } catch {
      // As above.
    }
  }
  return [...new Set(addresses)];
}
