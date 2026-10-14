/**
 * The parts of `pnpm run setup` (`scripts/setup.mjs`) that don't touch the
 * computer: the GitHub Apps' manifests, the page that sends them to GitHub,
 * turning GitHub's answer into the worker's secrets, and changing
 * `wrangler.jsonc`. GitHub's app manifest flow creates an app from a manifest
 * and gives back its id, keys and secret, so nothing is copied by hand.
 */
import type { Permissions } from "./github.js";
import { PERMISSIONS } from "./worker.js";

export type AppKind = "edit" | "owner";

export const APP_KINDS: AppKind[] = ["edit", "owner"];

/** The secrets' prefixes in `wrangler.jsonc` and the worker's settings. */
const PREFIX: Record<AppKind, string> = { edit: "EDIT", owner: "OWNER" };

/** What each app may do: everything the worker asks for in its tokens, since a token can't have more than its app. */
export function appPermissions(kind: AppKind): Permissions {
  const purposes = kind === "edit" ? [PERMISSIONS.edit] : [PERMISSIONS.owner, PERMISSIONS.setup];
  const permissions: Permissions = {};
  for (const purpose of purposes) {
    for (const [name, level] of Object.entries(purpose)) {
      if (permissions[name] !== "write") permissions[name] = level;
    }
  }
  return permissions;
}

export interface ManifestOptions {
  kind: AppKind;
  name: string;
  /** The worker's address, such as `https://sign-in.your-name.workers.dev`. */
  worker: string;
  /** Where GitHub sends the browser back to once the app is created. */
  redirect: string;
  /** Whether any account can install it, or only the one that owns it. */
  public: boolean;
  homepage?: string;
}

const DESCRIPTIONS: Record<AppKind, string> = {
  edit: "Signs editors in to Goodfellow sites' admin panels, which can then change the site's files.",
  owner:
    "Lets the owners of Goodfellow sites change who edits them and their GitHub Pages settings, and create new sites.",
};

/** A GitHub App manifest, as GitHub's "Create a GitHub App from a manifest" takes it. */
export function appManifest(options: ManifestOptions) {
  const worker = options.worker.replace(/\/$/, "");
  return {
    name: options.name,
    url: options.homepage ?? "https://goodfellow-cms.github.io/goodfellow-cms/",
    description: DESCRIPTIONS[options.kind],
    // The worker needs no events, but GitHub wants an address for them.
    hook_attributes: { url: worker, active: false },
    redirect_url: options.redirect,
    callback_urls: [`${worker}/github/callback`],
    // Installing signs the person in too, so a site's first sign-in installs the app.
    request_oauth_on_install: true,
    public: options.public,
    default_permissions: appPermissions(options.kind),
    default_events: [] as string[],
  };
}

/** Where to post a manifest: the person's own settings, or an organization's. */
export function manifestAction(state: string, organization?: string, web = "https://github.com"): string {
  const base = organization
    ? `${web}/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : `${web}/settings/apps/new`;
  return `${base}?${new URLSearchParams({ state })}`;
}

/** What GitHub gives back for a created app. */
export interface CreatedApp {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  pem: string;
  html_url?: string;
}

/** Turns the code GitHub came back with into the app's details. Each code works once, within an hour. */
export async function convertManifest(
  code: string,
  fetcher: typeof fetch = fetch,
  api = "https://api.github.com",
): Promise<CreatedApp> {
  const response = await fetcher(`${api}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) {
    throw new Error(`GitHub didn't give the app's details (${response.status}). Try creating the app again.`);
  }
  const app = (await response.json()) as Partial<CreatedApp>;
  if (!app.id || !app.slug || !app.client_id || !app.client_secret || !app.pem) {
    throw new Error("GitHub's answer didn't include the app's keys. Try creating the app again.");
  }
  return app as CreatedApp;
}

/** The worker's secrets for an app. */
export function appSecrets(kind: AppKind, app: CreatedApp): Record<string, string> {
  const prefix = PREFIX[kind];
  return {
    [`${prefix}_APP_ID`]: String(app.id),
    [`${prefix}_CLIENT_ID`]: app.client_id,
    [`${prefix}_CLIENT_SECRET`]: app.client_secret,
    [`${prefix}_PRIVATE_KEY`]: app.pem,
  };
}

/** The setting naming an app's slug, which the worker links to its install page with. */
export function slugVar(kind: AppKind): string {
  return `${PREFIX[kind]}_APP_SLUG`;
}

/** The secrets an app needs, to tell whether the worker already has it. */
export function hasAppSecrets(kind: AppKind, secrets: string[]): boolean {
  const prefix = PREFIX[kind];
  return ["APP_ID", "CLIENT_ID", "CLIENT_SECRET", "PRIVATE_KEY"].every((name) => secrets.includes(`${prefix}_${name}`));
}

/** A key for sealing sessions: 32 random bytes, in base64. */
export function newSessionKey(): string {
  let binary = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(32))) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Reads a setting from `wrangler.jsonc`'s `vars`. */
export function readVar(config: string, name: string): string | undefined {
  const match = config.match(new RegExp(`"${name}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`));
  return match ? (JSON.parse(match[1] as string) as string) : undefined;
}

/** Changes settings in `wrangler.jsonc`'s `vars`, keeping its comments and layout. Every setting must be there already. */
export function withVars(config: string, vars: Record<string, string>): string {
  let changed = config;
  for (const [name, value] of Object.entries(vars)) {
    const pattern = new RegExp(`("${name}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    if (!pattern.test(changed)) throw new Error(`wrangler.jsonc has no ${name} setting.`);
    changed = changed.replace(pattern, (_, key: string) => `${key}${JSON.stringify(value)}`);
  }
  return changed;
}

/**
 * The worker's address, from the lines Wrangler writes to `WRANGLER_OUTPUT_FILE_PATH`:
 * its `workers.dev` address if it has one, or else the first `https://` one.
 */
export function deployedAddress(output: string): string | undefined {
  const targets: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; targets?: unknown };
      if (entry.type === "deploy" && Array.isArray(entry.targets)) {
        targets.push(...entry.targets.filter((target): target is string => typeof target === "string"));
      }
    } catch {
      // Not one of Wrangler's lines.
    }
  }
  const addresses = targets.map((target) => target.trim()).filter((target) => /^https:\/\/[^\s/]+$/.test(target));
  return (addresses.find((address) => address.endsWith(".workers.dev")) ?? addresses[0])?.replace(/\/$/, "");
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );
}

const APP_TITLES: Record<AppKind, string> = { edit: "the editors' app", owner: "the owners' app" };

export interface SetupPageOptions {
  /** The app to create next, or none once both are. */
  next?: { kind: AppKind; action: string; manifest: ReturnType<typeof appManifest> };
  created: Partial<Record<AppKind, CreatedApp>>;
  problem?: string;
}

/** The page the setup script opens, which posts each app's manifest to GitHub in turn. */
export function setupPage(options: SetupPageOptions): string {
  const done = APP_KINDS.filter((kind) => options.created[kind]).map(
    (kind) =>
      `<li>Created ${APP_TITLES[kind]}, <strong>${escapeHtml(options.created[kind]?.slug ?? "")}</strong>.</li>`,
  );
  const body = options.next
    ? `<p>Next, create ${APP_TITLES[options.next.kind]}. GitHub shows its settings, filled in already: check the name, which people will see when they sign in, and choose <strong>Create GitHub App</strong>.</p>
<form method="post" action="${escapeHtml(options.next.action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(options.next.manifest))}">
<button type="submit">Create ${APP_TITLES[options.next.kind]} on GitHub</button>
</form>`
    : "<p><strong>Both apps are created.</strong> You can close this page and go back to the terminal.</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up the sign-in service</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
button { font: inherit; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #1f883d; background: #1f883d; color: #fff; cursor: pointer; }
.problem { color: #b42318; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } .problem { color: #ff7b72; } }
</style>
</head>
<body>
<h1>Set up the sign-in service</h1>
<p>The sign-in service needs two GitHub Apps: one that signs editors in, and one for owners, which can change who edits a site and its settings.</p>
${done.length ? `<ul>${done.join("")}</ul>` : ""}
${options.problem ? `<p class="problem">${escapeHtml(options.problem)}</p>` : ""}
${body}
</body>
</html>
`;
}
