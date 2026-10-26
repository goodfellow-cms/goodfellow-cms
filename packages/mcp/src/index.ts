/**
 * The Claude connector's tools, for any MCP server: the one on the editor's
 * computer (`goodfellow-mcp`) and the hosted connector's Worker.
 */
import { GOODFELLOW_VERSION } from "@goodfellow-cms/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConnectorContext } from "./site.js";
import { INSTRUCTIONS, registerTools } from "./tools.js";

export { contentFiles, ToolError } from "./content.js";
export { imagePage } from "./image-page.js";
export type { ConnectorContext, Screenshotter } from "./site.js";
export { INSTRUCTIONS } from "./tools.js";

/** A site's id for the tools: its host, then its repository, such as `github:parish/site`. */
export type SiteId = `github:${string}` | `gitlab:${string}` | `bitbucket:${string}`;

/** Splits a site's id into its host and repository, or `undefined` if it isn't one. */
export function parseSiteId(id: string): { host: "github" | "gitlab" | "bitbucket"; repo: string } | undefined {
  const match = /^(github|gitlab|bitbucket):([\w.-]+(?:\/[\w.-]+)+)$/.exec(id.trim());
  if (!match) return undefined;
  const [, host, repo] = match;
  // GitHub's and Bitbucket's repositories are always an owner, then a name; GitLab's groups can nest.
  if (host !== "gitlab" && repo?.split("/").length !== 2) return undefined;
  return { host: host as "github" | "gitlab" | "bitbucket", repo: repo ?? "" };
}

/** An MCP server with Goodfellow's tools. Connect it to a transport. */
export function createGoodfellowServer(context: ConnectorContext): McpServer {
  const server = new McpServer({ name: "goodfellow", version: GOODFELLOW_VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, context);
  return server;
}
