// What the full-stack setup page and the page GitHub sends people back to share, with no React: the channel the
// return page tells the setup page's tab on, what it tells it, and the links the setup page makes from what it learns.

/** The channel the return page (`/new-site/full-stack/app/`) tells the setup page's tab on, in the same browser. */
export const APP_CHANNEL = "goodfellow:setup:publishing-app";

/** The return page's address under the site's base path. */
export const APP_RETURN_PATH = "/new-site/full-stack/app/";

/** What GitHub sent the browser back with: the code for a newly made app, or an installation. */
export type AppReturn =
  | { kind: "created"; code: string; state: string }
  | { kind: "installed"; installation: number; state: string };

const STATE = /^[0-9a-f]{32}$/;

/** A state of the setup page's own, which only what GitHub sends back for that page carries. */
export function newAppState(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What the return page's query says, where it says something the setup page asked for. */
export function appReturnOf(search: string): AppReturn | undefined {
  const query = new URLSearchParams(search);
  const state = query.get("state") ?? "";
  if (!STATE.test(state)) return undefined;
  const code = query.get("code");
  if (code !== null) return /^[\w-]{1,200}$/.test(code) ? { kind: "created", code, state } : undefined;
  const installation = query.get("installation_id") ?? "";
  if (/^\d{1,20}$/.test(installation)) return { kind: "installed", installation: Number(installation), state };
  return undefined;
}

/** What the return page posts, read as the setup page reads it: only what fits, and only for its own state. */
export function appReturnFor(data: unknown, state: string): AppReturn | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = data as Partial<Record<string, unknown>>;
  if (message.state !== state) return undefined;
  if (message.kind === "created" && typeof message.code === "string" && /^[\w-]{1,200}$/.test(message.code)) {
    return { kind: "created", code: message.code, state };
  }
  if (message.kind === "installed" && typeof message.installation === "number") {
    return { kind: "installed", installation: message.installation, state };
  }
  return undefined;
}

/** The Worker's own address, once Set up Cloudflare has written it into `wrangler.jsonc`. */
export function workersAddressIn(wrangler: string): string | undefined {
  return /"GOODFELLOW_SITE_URL":\s*"(https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)"/.exec(wrangler)?.[1];
}

/**
 * The site's `/setup/` page with the setup code in its fragment, which browsers never send, and which the page reads
 * and takes out of the address straight away.
 */
export function setupLink(address: string, code: string): string {
  return `${address.replace(/\/$/, "")}/setup/#${new URLSearchParams({ code })}`;
}

/**
 * Which of the codes GitHub sends back the setup page turns into its app: the first after each time the app is asked
 * for, and no other, however soon it comes, so a code from another tab can't undo the app the first one made.
 */
export function appCodes(): { asked(): void; take(): boolean } {
  let waiting = false;
  return {
    asked() {
      waiting = true;
    },
    take() {
      const was = waiting;
      waiting = false;
      return was;
    },
  };
}
