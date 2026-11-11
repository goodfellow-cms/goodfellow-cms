import { type ContentSource, repositorySource } from "@goodfellow-cms/core";
import { goodfellowPages } from "@goodfellow-cms/next";
import config from "@/goodfellow.config";
import { env } from "@/lib/env";

let live: (() => Promise<ContentSource>) | undefined;

/**
 * The content repository as it is now, read with the token the admin panel's API publishes with, so a publish shows
 * once its pages render again, without a rebuild. In `next dev`, the files on this computer, as the admin panel's
 * local backend writes them.
 */
async function source(): Promise<ContentSource | undefined> {
  if (process.env.NODE_ENV === "development") return undefined;
  const token = (await env()).GOODFELLOW_GIT_TOKEN;
  const backend = config.backend;
  if (!token || !backend?.server) return undefined;
  live ??= repositorySource(backend.server({ token }));
  return live();
}

/** The site's pages, shared by the routes that show them. */
export const site = goodfellowPages(config, { source });
