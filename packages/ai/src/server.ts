import { trimChars } from "@goodfellow-cms/core";
import { PROVIDERS, type ProviderId, redact } from "./providers.js";

/** A key for a service, or the key and the address of its API, as `custom` needs, or for a service at another address. */
export type ServerKey = string | { key?: string; baseUrl: string };

/** The services whose requests a full-stack site's server sends on with its own keys, such as `{ anthropic: process.env.ANTHROPIC_API_KEY }`. */
export type ServerKeys = Partial<Record<Exclude<ProviderId, "manual">, ServerKey | undefined>>;

const ANTHROPIC_API = "https://api.anthropic.com";

/** The most an editor's request may send, which is far more than a page's worth of content. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

/** The headers sent on from the editor's request: never its cookies, or anything else the service doesn't need. */
const FORWARDED_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta"];

/** The parts of each API the assistant uses, which are all the server sends on. */
function allowed(service: ProviderId, method: string, path: string): boolean {
  if (service === "anthropic") return method === "POST" && path === "v1/messages";
  return (method === "POST" && path === "chat/completions") || (method === "GET" && path === "models");
}

function problem(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Sends the AI assistant's requests on to AI services with a full-stack site's
 * own keys, so editors don't need keys of their own and never see the site's.
 * Give it to `goodfellowApi({ ai })` from `@goodfellow-cms/next/server`, or
 * `appApi({ ai })` from `@goodfellow-cms/core/node`. Services without a key are left out.
 */
export function aiServer(keys: ServerKeys, options: { fetch?: typeof fetch } = {}) {
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const configured = Object.entries(keys).flatMap(([service, value]) =>
    value && (typeof value === "string" || value.baseUrl) ? [[service as ProviderId, value] as const] : [],
  );
  const services = new Map<ProviderId, ServerKey>(configured);

  async function forward(request: Request, name: string, path: string): Promise<Response> {
    const service = name as ProviderId;
    const value = services.get(service);
    if (!value) return problem(404, "This site has no key for that service.");
    if (!allowed(service, request.method, path)) return problem(404, "The AI assistant doesn't use that.");
    const key = typeof value === "string" ? value : value.key;
    const base =
      service === "anthropic"
        ? ANTHROPIC_API
        : typeof value === "object"
          ? value.baseUrl
          : (PROVIDERS[service].baseUrl ?? "");
    if (!base) return problem(404, "This site has no address for that service.");

    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > MAX_REQUEST_BYTES) return problem(413, "That request is too large.");
    const headers = new Headers();
    for (const header of FORWARDED_HEADERS) {
      const value = request.headers.get(header);
      if (value) headers.set(header, value);
    }
    if (key) {
      if (service === "anthropic") headers.set("x-api-key", key);
      else headers.set("authorization", `Bearer ${key}`);
    }
    const target = `${trimChars(base, "/", { start: false })}/${path}${new URL(request.url).search}`;
    let response: Response;
    try {
      response = await send(target, { method: request.method, headers, body, signal: request.signal });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      return problem(502, "The AI service couldn't be reached.");
    }
    // The service's own errors, without anything that looks like a key.
    if (!response.ok) {
      const text = redact(await response.text().catch(() => ""), key);
      return new Response(text, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "text/plain", "cache-control": "no-store" },
      });
    }
    // Answers are streamed as they arrive, as the assistant shows its progress.
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  }

  return { services: [...services.keys()] as string[], forward };
}
