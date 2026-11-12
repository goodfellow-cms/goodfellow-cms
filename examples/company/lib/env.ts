// The one place the site reads its bindings, variables, and secrets, so nothing else knows which host it runs on.

/** A Cloudflare D1 database, as its binding gives it: only what the database layer uses. */
export interface D1Binding {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown>;
  exec(query: string): Promise<unknown>;
}

/** What the site reads from where it runs. */
export interface SiteEnv {
  /** The D1 database, on Cloudflare. */
  DB?: D1Binding;
  /** A Postgres database's address, such as Neon's, where there's no D1. */
  DATABASE_URL?: string;
  /** Signs sessions and their cookies. At least 32 random characters. */
  BETTER_AUTH_SECRET?: string;
  /** The site's address, such as https://www.example.com, which sign-in trusts requests from. */
  GOODFELLOW_SITE_URL?: string;
  /**
   * The request header that holds a visitor's address, which sign-in's rate limit counts attempts by. Only a header
   * the host sets itself will do, since visitors can send any other: `cf-connecting-ip` on Cloudflare, which this
   * file fills in. Elsewhere Better Auth reads `x-forwarded-for`.
   */
  CLIENT_IP_HEADER?: string;
  /** The token the server publishes to the content repository with. */
  GOODFELLOW_GIT_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  /** Sends invitations and password resets (lib/email.ts): a Resend key that can only send, from the site's domain. */
  RESEND_API_KEY?: string;
  /** Who those emails are from, such as `Example Co <hello@example.org>`, on a domain Resend has verified. */
  EMAIL_FROM?: string;
  /** Resend's API, for tests to point elsewhere. */
  RESEND_API_URL?: string;
}

/** How a Worker keeps work going after it has answered; elsewhere, the process simply carries on. */
let keepGoing: ((work: Promise<unknown>) => void) | undefined;

/**
 * Runs `work` after the answer has gone, such as sending an email, so how long it takes says nothing about the
 * request: on Cloudflare through the Worker's `waitUntil()`, which `env()` finds.
 */
export function inBackground(work: Promise<unknown>): void {
  if (keepGoing) keepGoing(work);
  else void work;
}

/** Whether this is a Cloudflare Worker, which says so in its user agent. */
function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

let cached: Promise<SiteEnv> | undefined;

/**
 * The site's bindings and variables: on Cloudflare, the Worker's (`cloudflare:workers`, its D1 binding and its
 * secrets); in `next dev`, the same from wrangler.jsonc and .dev.vars, with a D1 database kept on this computer in
 * .wrangler/, unless `DATABASE_URL` names a Postgres one; anywhere else, `process.env`.
 */
export function env(): Promise<SiteEnv> {
  cached ??= (async () => {
    if (onWorkers()) {
      // Left to the Worker to resolve: it's workerd's own module, which no other runtime has.
      const workers = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ "cloudflare:workers"
      )) as {
        env: SiteEnv;
        waitUntil?: (work: Promise<unknown>) => void;
      };
      keepGoing = workers.waitUntil;
      return { CLIENT_IP_HEADER: "cf-connecting-ip", ...workers.env };
    }
    // Left out of builds, where NODE_ENV is "production", so wrangler is never bundled.
    if (process.env.NODE_ENV === "development") {
      const { getPlatformProxy } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "wrangler");
      const { env: bindings } = await getPlatformProxy<SiteEnv>();
      // `DATABASE_URL` in .env.local chooses Postgres over the local D1 database, keeping .dev.vars' settings.
      const { DB, ...settings } = bindings;
      return { ...(process.env as SiteEnv), ...settings, ...(!process.env.DATABASE_URL && { DB }) };
    }
    return process.env as SiteEnv;
  })();
  return cached;
}
