/**
 * The parts of `pnpm run setup` (`scripts/setup.mjs`) that don't touch the
 * computer: the GitHub App's manifest, the page that sends it to GitHub, the
 * connector's secrets, and the database's id in `wrangler.jsonc`.
 */
import type { CreatedApp } from "@goodfellow-cms/worker/setup";
import { PERMISSIONS } from "./permissions.js";

export const DATABASE_NAME = "goodfellow-connector";

/** A GitHub App manifest for the Goodfellow for Claude app. */
export function connectorManifest(options: { name: string; connector: string; redirect: string; public: boolean }) {
  const connector = options.connector.replace(/\/$/, "");
  return {
    name: options.name,
    url: "https://goodfellow-cms.github.io/goodfellow-cms/docs/claude",
    description:
      "Lets Claude work on Goodfellow sites: read their pages, change them in drafts, and publish them when the editor says so.",
    // The connector needs no events, but GitHub wants an address for them.
    hook_attributes: { url: connector, active: false },
    redirect_url: options.redirect,
    callback_urls: [`${connector}/connect/github/callback`],
    // Installing signs the person in too, so connecting can install the app on the way.
    request_oauth_on_install: true,
    public: options.public,
    default_permissions: PERMISSIONS,
    default_events: [] as string[],
  };
}

/** The connector's secrets for the app. */
export function connectorSecrets(app: CreatedApp): Record<string, string> {
  return {
    GITHUB_APP_ID: String(app.id),
    GITHUB_CLIENT_ID: app.client_id,
    GITHUB_CLIENT_SECRET: app.client_secret,
    GITHUB_PRIVATE_KEY: app.pem,
  };
}

export const GITHUB_SECRETS = ["GITHUB_APP_ID", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_PRIVATE_KEY"];

/** The database's id, from `wrangler d1 list --json`. */
export function databaseId(list: string, name = DATABASE_NAME): string | undefined {
  try {
    const databases = JSON.parse(list.slice(list.indexOf("["))) as Array<{ uuid?: string; name?: string }>;
    return databases.find((database) => database.name === name)?.uuid;
  } catch {
    return undefined;
  }
}

/** Puts the database's id in `wrangler.jsonc`, keeping its comments and layout. */
export function withDatabaseId(config: string, id: string): string {
  const pattern = /("database_id"\s*:\s*)"[^"]*"/;
  if (!pattern.test(config)) throw new Error("wrangler.jsonc has no database_id setting.");
  return config.replace(pattern, (_, key: string) => `${key}${JSON.stringify(id)}`);
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );
}

/** The page the setup script opens, which posts the app's manifest to GitHub. */
export function setupPage(options: {
  action?: string;
  manifest?: ReturnType<typeof connectorManifest>;
  created?: CreatedApp;
  problem?: string;
}): string {
  const body =
    options.created || !options.action || !options.manifest
      ? `<p><strong>Created the app, ${escapeHtml(options.created?.slug ?? "")}.</strong> You can close this page and go back to the terminal.</p>`
      : `<p>GitHub shows the app's settings, filled in already: check the name, which people will see when they connect Claude, and choose <strong>Create GitHub App</strong>.</p>
<form method="post" action="${escapeHtml(options.action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(options.manifest))}">
<button type="submit">Create the app on GitHub</button>
</form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up the Claude connector</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
button { font: inherit; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #1f883d; background: #1f883d; color: #fff; cursor: pointer; }
.problem { color: #b42318; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } .problem { color: #ff7b72; } }
</style>
</head>
<body>
<h1>Set up the Claude connector</h1>
<p>The connector works on sites on GitHub through a GitHub App, which a site's owner installs on the site's repository.</p>
${options.problem ? `<p class="problem">${escapeHtml(options.problem)}</p>` : ""}
${body}
</body>
</html>
`;
}
