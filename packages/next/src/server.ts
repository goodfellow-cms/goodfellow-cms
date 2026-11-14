import { aiServer, type ServerKeys } from "@goodfellow-cms/ai";
import {
  type CollectionSource,
  checkSourceModules,
  collectionSource,
  type GoodfellowConfig,
  ownersOnlyFields,
  type SourceModuleImport,
} from "@goodfellow-cms/core";
import { type AppApiOptions, appApi } from "@goodfellow-cms/core/server";

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
  /**
   * Called after each publish from the admin panel, before the editor hears
   * it worked, with the files it changed (`paths`), who published them
   * (`editor`) and the new `revision`: for instance to refresh the pages
   * they're on, or to tell another system. A failure goes to `onError`, since
   * the publish has already happened. The site still rebuilds as usual.
   */
  onPublish?: AppApiOptions["onPublish"];
  /**
   * The server modules of the config's plugins, by plugin name, imported in
   * the route's file, such as `{ "goodfellow-plugin-s3": s3Server }` from
   * `import s3Server from "goodfellow-plugin-s3/server"`. Each answers
   * `plugins/<id>/…`, and runs with everything the server has.
   */
  plugins?: AppApiOptions["plugins"];
  /**
   * Whether owners' changes to the site's code, such as adding blocks on the
   * Blocks screen, go to a developer for review (`"review"`, the default),
   * since this server runs that code with its token and keys, or are published
   * (`"publish"`).
   */
  codeChanges?: AppApiOptions["codeChanges"];
  /**
   * Checks plugins and themes owners install before they're three days old,
   * where their provenance allows it: `nodeProvenance()` from
   * `@goodfellow-cms/core/node` on servers that run Node, which checks it with
   * npm's registry and Sigstore. Without it, the admin panel doesn't offer
   * them, and they wait until they're old enough.
   */
  provenance?: AppApiOptions["provenance"];
  /**
   * The modules of the sources the config's `collections` name, by collection
   * id, as `goodfellowPages()` is given them, so the admin panel can show their
   * items. Throws on the first request where the config names one that's missing.
   */
  sources?: Record<string, SourceModuleImport>;
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
    // Every collection's module should be there, which is said here, on the server; but one that's missing fails only
    // its collection's items (`collectionSource()`), never signing in or publishing, and each source is made only when
    // the admin panel asks for its items.
    try {
      checkSourceModules(options.config.collections, options.sources ?? {});
    } catch (error) {
      if (options.onError) options.onError(error);
      else console.error(error instanceof Error ? error.message : String(error));
    }
    const sources = new Map<string, CollectionSource | undefined>();
    api = appApi({
      git: backend.server({ token }),
      authorize: options.authorize,
      signIn: options.signIn,
      ...(options.signOut && { signOut: options.signOut }),
      ...(ai && ai.services.length > 0 && { ai }),
      ...(options.onError && { onError: options.onError }),
      ...(options.onPublish && { onPublish: options.onPublish }),
      ...(options.plugins && { plugins: options.plugins }),
      ...(options.codeChanges && { codeChanges: options.codeChanges }),
      ...(options.provenance && { provenance: options.provenance }),
      ownersOnly: ownersOnlyFields(options.config.blocks ?? {}),
      sources: (id) => {
        // Only the collections the config names are kept, so asking for others' items adds nothing to remember.
        if (!Object.hasOwn(options.config.collections ?? {}, id)) return undefined;
        if (!sources.has(id)) sources.set(id, collectionSource(options.config.collections, options.sources ?? {}, id));
        return sources.get(id);
      },
    });
    return api;
  }

  const route = async (request: Request, context: RouteContext): Promise<Response> =>
    handler()(request, ((await context.params).path ?? []).join("/"));
  return { GET: route, POST: route };
}
