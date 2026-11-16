import type { HostSource } from "@goodfellow-cms/core";
import { publishingAppToken } from "@goodfellow-cms/github/app";
import { env, type SiteEnv } from "./env.ts";

/** The content repository a backend names, and GitHub's API where it names one, as tests do. */
function contentRepository(source: HostSource | undefined): { repo: string; api?: string } {
  const options = source?.options ?? {};
  if (source?.package !== "@goodfellow-cms/github" || typeof options.repo !== "string") {
    throw new Error("The site's publishing app needs goodfellow.config.tsx's backend to be a GitHub repository.");
  }
  return { repo: options.repo, ...(typeof options.apiUrl === "string" && { api: options.apiUrl }) };
}

/**
 * The token the server reads and publishes to the content repository with, asked for on each request: from the
 * site's own publishing app (`GOODFELLOW_APP_ID` and `GOODFELLOW_APP_KEY`, which Goodfellow's setup page makes), an
 * hour-long token for the content repository alone, made again as it ends; or else `GOODFELLOW_GIT_TOKEN`, a
 * fine-grained token made by hand. `backend` is the config's.
 */
export function gitToken(
  backend: { source?: HostSource } | undefined,
  read: () => Promise<SiteEnv> = env,
): () => Promise<string> {
  let fromApp: { key: string; token: () => Promise<string> } | undefined;
  return async () => {
    const vars = await read();
    if (vars.GOODFELLOW_APP_ID && vars.GOODFELLOW_APP_KEY) {
      const key = `${vars.GOODFELLOW_APP_ID}\n${vars.GOODFELLOW_APP_KEY}`;
      if (fromApp?.key !== key) {
        const token = publishingAppToken({
          appId: vars.GOODFELLOW_APP_ID,
          privateKey: vars.GOODFELLOW_APP_KEY,
          ...contentRepository(backend?.source),
        });
        fromApp = { key, token };
      }
      return fromApp.token();
    }
    if (vars.GOODFELLOW_GIT_TOKEN) return vars.GOODFELLOW_GIT_TOKEN;
    throw new Error(
      "Set GOODFELLOW_APP_ID and GOODFELLOW_APP_KEY, the site's publishing app, or GOODFELLOW_GIT_TOKEN, a token that can publish to the content repository.",
    );
  };
}
