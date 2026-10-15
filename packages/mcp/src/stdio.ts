#!/usr/bin/env node
/**
 * Goodfellow's tools on the editor's computer, for Claude Desktop (as an
 * extension) and Claude Code (`claude mcp add`). It signs in with a token,
 * which stays on this computer:
 *
 *   GOODFELLOW_SITE=github:owner/site GOODFELLOW_TOKEN=… npx @goodfellow-cms/mcp
 *
 * GitLab sites are `gitlab:group/site`, with `GITLAB_URL` for self-managed
 * GitLab. `GOODFELLOW_BROWSER` points screenshots at a browser other than
 * Chrome or Edge.
 */
import type { GitBackend, StorageLike } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { gitlab } from "@goodfellow-cms/gitlab";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolError } from "./content.js";
import { createGoodfellowServer, parseSiteId } from "./index.js";
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

const siteId = process.env.GOODFELLOW_SITE?.trim() || process.argv[2];
const token = process.env.GOODFELLOW_TOKEN?.trim();
if (!siteId) fail("Set GOODFELLOW_SITE to the site's repository, such as github:owner/site or gitlab:group/site.");
const site = parseSiteId(siteId);
if (!site) fail(`${siteId} isn't a site. Write it as github:owner/site or gitlab:group/site.`);
if (!token) fail("Set GOODFELLOW_TOKEN to a GitHub or GitLab token that can edit the site.");

const storage = { local: memoryStorage(), session: memoryStorage() };
const host =
  site.host === "github"
    ? github({ repo: site.repo, signIn: false, storage })
    : gitlab({ project: site.repo, ...(process.env.GITLAB_URL && { url: process.env.GITLAB_URL }), storage });

let signedIn: Promise<GitBackend> | undefined;
const server = createGoodfellowServer({
  sites: async () => [{ id: siteId }],
  backend: async (id) => {
    if (id !== siteId) throw new ToolError(`This connector only edits ${siteId}.`);
    signedIn ??= host.signInWithToken(token, false).catch((error: unknown) => {
      signedIn = undefined;
      throw error;
    });
    return signedIn;
  },
  screenshots: localScreenshots(
    process.env.GOODFELLOW_BROWSER ? { executablePath: process.env.GOODFELLOW_BROWSER } : {},
  ),
});

await server.connect(new StdioServerTransport());
