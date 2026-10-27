#!/usr/bin/env node
import { basename } from "node:path";
/**
 * Goodfellow's tools on the editor's computer, for Claude Desktop (as an
 * extension) and Claude Code (`claude mcp add`). It signs in with tokens,
 * which stay on this computer:
 *
 *   GOODFELLOW_SITE=github:owner/site GOODFELLOW_TOKEN=… npx @goodfellow-cms/mcp
 *
 * `GOODFELLOW_SITE` can name several sites, separated by commas or new lines,
 * and so can the arguments: GitHub repositories (`github:owner/site`), GitLab
 * projects (`gitlab:group/site`, with `GITLAB_URL` for self-managed GitLab),
 * Bitbucket repositories (`bitbucket:workspace/site`, with an access token or
 * an API token after its account's email address, `email:token`) and folders
 * on this computer (`local:C:\Sites\parish`, or the folder's full path), read
 * through their development server. `GOODFELLOW_TOKEN` signs in to every host;
 * `GOODFELLOW_GITHUB_TOKEN`, `GOODFELLOW_GITLAB_TOKEN` and
 * `GOODFELLOW_BITBUCKET_TOKEN` sign in to one each. `GOODFELLOW_BROWSER` points
 * screenshots at a browser other than Chrome or Edge.
 */
import { bitbucket } from "@goodfellow-cms/bitbucket";
import type { GitBackend, GitHost, StorageLike } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { gitlab } from "@goodfellow-cms/gitlab";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolError } from "./content.js";
import { createGoodfellowServer, parseSiteId } from "./index.js";
import { isSiteFolder, type LocalSite, localBackend, parseLocalSite, servedAt } from "./local.js";
import { localScreenshots } from "./screenshots.js";

/** Sign-ins keep nothing on disk: the token comes from the environment every time. */
function memoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function fail(message: string): never {
  process.stderr.write(`goodfellow-mcp: ${message}\n`);
  process.exit(1);
}

/** The sites given, from the environment and the arguments, each once. */
function givenSites(): string[] {
  const listed = [process.env.GOODFELLOW_SITE ?? "", ...process.argv.slice(2)]
    .flatMap((value) => value.split(/[\n,]/))
    .map((value) => value.trim())
    // Claude Desktop may leave a setting nobody filled in as its placeholder.
    .filter((value) => value && !value.startsWith("${"));
  return [...new Set(listed)];
}

const HOST_TOKENS = {
  github: "GOODFELLOW_GITHUB_TOKEN",
  gitlab: "GOODFELLOW_GITLAB_TOKEN",
  bitbucket: "GOODFELLOW_BITBUCKET_TOKEN",
} as const;

function setting(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("${") ? value : undefined;
}

function tokenFor(host: keyof typeof HOST_TOKENS): string | undefined {
  return setting(HOST_TOKENS[host]) ?? setting("GOODFELLOW_TOKEN");
}

interface Site {
  id: string;
  label: string;
  backend: () => Promise<GitBackend>;
  local?: LocalSite;
}

const given = givenSites();
if (given.length === 0) {
  fail(
    "Set GOODFELLOW_SITE to the site's repository, such as github:owner/site, gitlab:group/site or bitbucket:workspace/site, or the folder it's in on this computer. Separate several with commas.",
  );
}

const sites = new Map<string, Site>();
for (const entry of given) {
  const local = parseLocalSite(entry);
  if (local) {
    if (!isSiteFolder(local.folder)) fail(`${local.folder} isn't a Goodfellow site: it has no content/site.json.`);
    const backend = localBackend(local.folder);
    sites.set(local.id, { id: local.id, label: basename(local.folder), backend: async () => backend, local });
    continue;
  }
  const site = parseSiteId(entry);
  if (!site) {
    fail(
      `${entry} isn't a site. Write it as github:owner/site, gitlab:group/site or bitbucket:workspace/site, or the full path of a folder on this computer.`,
    );
  }
  const token = tokenFor(site.host);
  if (!token) {
    fail(`Set GOODFELLOW_TOKEN, or ${HOST_TOKENS[site.host]}, to a token that can edit ${entry}.`);
  }
  const storage = { local: memoryStorage(), session: memoryStorage() };
  const host: GitHost =
    site.host === "github"
      ? github({ repo: site.repo, signIn: false, storage })
      : site.host === "bitbucket"
        ? bitbucket({ repo: site.repo, storage })
        : gitlab({ project: site.repo, ...(setting("GITLAB_URL") && { url: setting("GITLAB_URL") }), storage });
  let signedIn: Promise<GitBackend> | undefined;
  sites.set(entry, {
    id: entry,
    label: entry,
    backend: () => {
      signedIn ??= host.signInWithToken(token, false).catch((error: unknown) => {
        signedIn = undefined;
        throw error;
      });
      return signedIn;
    },
  });
}

function siteFor(id: string): Site {
  const site = sites.get(id) ?? sites.get(parseLocalSite(id)?.id ?? "");
  if (!site) throw new ToolError(`This connector edits ${[...sites.keys()].join(", ")}, not ${id}.`);
  return site;
}

const server = createGoodfellowServer({
  sites: async () => [...sites.values()].map((site) => ({ id: site.id, label: site.label })),
  backend: (id) => siteFor(id).backend(),
  served: async (id) => {
    const { local } = siteFor(id);
    return local ? servedAt(local) : undefined;
  },
  screenshots: localScreenshots(
    process.env.GOODFELLOW_BROWSER ? { executablePath: process.env.GOODFELLOW_BROWSER } : {},
  ),
});

await server.connect(new StdioServerTransport());
