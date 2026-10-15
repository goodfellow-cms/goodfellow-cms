import { aiServer, type ServerKeys } from "@goodfellow-cms/ai";
import { calendarFiles, type GoodfellowConfig, loadSiteContent } from "@goodfellow-cms/core";
import { type AppApiOptions, appApi, fileSystemSource } from "@goodfellow-cms/core/node";

/** The environment variable the server's token is read from, unless `goodfellowApi({ token })` gives one. */
export const GIT_TOKEN_VARIABLE = "GOODFELLOW_GIT_TOKEN";

export interface GoodfellowApiOptions {
  /** The site's `goodfellow.config.tsx`, whose `backend` says where the site is stored. */
  config: GoodfellowConfig;
  /**
   * A token that can read and publish to the site's repository, such as a
   * fine-grained GitHub token or a GitLab project access token. It never
   * reaches a browser. Defaults to the `GOODFELLOW_GIT_TOKEN` environment variable.
   */
  token?: string | (() => Promise<string>);
  /**
   * Who's signed in, from the site's own sign-in (such as Better Auth's
   * `auth.api.getSession({ headers: request.headers })`): their name, email
   * address and role, or `null` if nobody is, or `false` if they may not edit.
   */
  authorize: AppApiOptions["authorize"];
  /** Where the admin panel sends people to sign in, such as `/sign-in?next=/admin/`. */
  signIn: string;
  /** Where the admin panel's Sign out button goes, if the site has an address for it. */
  signOut?: string;
  /**
   * Keys for AI services, such as `{ anthropic: process.env.ANTHROPIC_API_KEY }`,
   * so the AI assistant's requests go through the server and editors need no
   * keys of their own. Services without a key are left out.
   */
  ai?: ServerKeys;
  /** Told about failures editors only hear about as "something went wrong". Defaults to `console.error`. */
  onError?: (error: unknown) => void;
}

/** The route parameters of a catch-all route named `[...path]`. */
interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

/**
 * The admin panel's API on a full-stack Next.js site, for
 * `app/api/goodfellow/[...path]/route.ts`:
 *
 * ```ts
 * export const { GET, POST } = goodfellowApi({ config, authorize, signIn: "/sign-in" });
 * ```
 *
 * The admin panel (`<GoodfellowAdmin server="/api/goodfellow" />`) reads and
 * publishes through it, and the server reaches the repository with its own
 * token, naming each editor as the author of what they publish.
 */
export function goodfellowApi(options: GoodfellowApiOptions) {
  let api: ReturnType<typeof appApi> | undefined;

  // Made on the first request, so building the site needs no token.
  function handler(): ReturnType<typeof appApi> {
    if (api) return api;
    const { backend } = options.config;
    if (!backend?.server) {
      throw new Error("goodfellowApi() needs the config's `backend`, such as github({ repo }) or gitlab({ project }).");
    }
    const token =
      options.token ||
      process.env[GIT_TOKEN_VARIABLE] ||
      (() => {
        throw new Error(`goodfellowApi() needs a token: set ${GIT_TOKEN_VARIABLE}, or pass \`token\`.`);
      })();
    const ai = options.ai && aiServer(options.ai);
    api = appApi({
      git: backend.server({ token }),
      authorize: options.authorize,
      signIn: options.signIn,
      ...(options.signOut && { signOut: options.signOut }),
      ...(ai && ai.services.length > 0 && { ai }),
      ...(options.onError && { onError: options.onError }),
    });
    return api;
  }

  const route = async (request: Request, context: RouteContext): Promise<Response> =>
    handler()(request, ((await context.params).path ?? []).join("/"));
  return { GET: route, POST: route };
}

/**
 * The site's calendar files, for `app/calendars/[...path]/route.ts` on a
 * full-stack site, where `goodfellow-next finish` doesn't write them:
 * `export const GET = goodfellowCalendars();`.
 */
export function goodfellowCalendars({ root }: { root?: string } = {}) {
  return async (_request: Request, context: RouteContext): Promise<Response> => {
    const path = `/calendars/${((await context.params).path ?? []).join("/")}`;
    const content = await loadSiteContent(fileSystemSource(root ?? process.cwd()));
    const file = calendarFiles(content).find((candidate) => candidate.path === path);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file.content, { headers: { "content-type": "text/calendar; charset=utf-8" } });
  };
}
