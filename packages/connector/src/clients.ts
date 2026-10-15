/**
 * The apps that connect to the connector, as OAuth clients. Claude and other
 * MCP clients name themselves in one of two ways, and the connector stores
 * neither:
 *
 * - Client ID metadata documents: the client's id is the address of a JSON
 *   document describing it, which the connector reads each time.
 * - Dynamic client registration: the client posts its details to `/register`
 *   and gets an id, which is those details sealed.
 */
import type { Sealer } from "@goodfellow-cms/worker/seal";

export interface Client {
  id: string;
  name: string;
  redirectUris: string[];
}

/** How long a registered client's id works. Clients register again when theirs stops. */
const CLIENT_LIFETIME = 365 * 24 * 3_600_000;
const MAX_DOCUMENT_BYTES = 16_384;

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/** Whether a client may be sent back to `uri`: an `https://` address, or an app on this computer. */
export function isAllowedRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname));
}

/** Whether `given` is one of the client's addresses. Apps on this computer may use any port, as RFC 8252 says. */
export function redirectMatches(client: Client, given: string): boolean {
  return client.redirectUris.some((registered) => {
    if (registered === given) return true;
    try {
      const a = new URL(registered);
      const b = new URL(given);
      return (
        a.protocol === "http:" &&
        isLoopback(a.hostname) &&
        a.protocol === b.protocol &&
        a.hostname === b.hostname &&
        a.pathname === b.pathname &&
        a.search === b.search
      );
    } catch {
      return false;
    }
  });
}

export class ClientError extends Error {
  override name = "ClientError";
}

function clientName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;
}

/** Registers a client, as RFC 7591 describes: the answer's `client_id` is its details, sealed. */
export async function registerClient(sealer: Sealer, body: Record<string, unknown>, now: number) {
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    throw new ClientError("redirect_uris must list the client's addresses.");
  }
  if (!redirectUris.every(isAllowedRedirect)) {
    throw new ClientError("Each redirect URI must be an https:// address or an app on this computer.");
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") throw new ClientError("Clients are public: token_endpoint_auth_method must be none.");
  const name = clientName(body.client_name, new URL(redirectUris[0] as string).host);
  const id = await sealer.seal("client", { name, redirectUris }, CLIENT_LIFETIME);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

/** Whether `id` is a client ID metadata document's address. */
function isDocumentAddress(id: string): boolean {
  try {
    const url = new URL(id);
    return url.protocol === "https:" && url.pathname !== "/" && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** The client a `client_id` names, or `undefined` if it doesn't name one. */
export async function findClient(sealer: Sealer, id: string, fetcher: typeof fetch): Promise<Client | undefined> {
  if (!id || id.length > 4096) return undefined;
  if (!id.startsWith("https://")) {
    const registered = await sealer.open<{ name: string; redirectUris: string[] }>("client", id);
    return registered && { id, ...registered };
  }
  if (!isDocumentAddress(id)) return undefined;
  let document: Record<string, unknown>;
  try {
    const response = await fetcher(id, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > MAX_DOCUMENT_BYTES) return undefined;
    document = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!document || document.client_id !== id) return undefined;
  const redirectUris = document.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every(isAllowedRedirect)) return undefined;
  const method = document.token_endpoint_auth_method ?? "none";
  if (method !== "none") return undefined;
  return { id, name: clientName(document.client_name, new URL(id).host), redirectUris };
}
