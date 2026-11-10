import { trimChars } from "@goodfellow-cms/core";
import { CLAUDE_MODELS, PROVIDERS, type ProviderId, redact } from "./providers.js";

/**
 * A key for a service, or the key and the address of its API, as `custom`
 * needs, or for a service at another address, with the `models` editors may
 * ask for where it has others that cost more.
 */
export type ServerKey = string | { key?: string; baseUrl: string; models?: string[] };

/** The services whose requests a full-stack site's server sends on with its own keys, such as `{ anthropic: process.env.ANTHROPIC_API_KEY }`. */
export type ServerKeys = Partial<Record<Exclude<ProviderId, "manual">, ServerKey | undefined>>;

const ANTHROPIC_API = "https://api.anthropic.com";

/** The most an editor's request may send, which is far more than a page's worth of content. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

/** The headers sent on from the editor's request: never its cookies, or anything else the service doesn't need. */
const FORWARDED_HEADERS = ["content-type", "accept", "anthropic-version"];

/** The betas the assistant asks Claude for, which are all the server sends on. */
const ANTHROPIC_BETAS = new Set(["server-side-fallback-2026-07-01"]);

/** The most Claude's answer may be, as the assistant asks. */
const MAX_TOKENS = 64000;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";

/** The messages, where each is one of `roles` with text, as the assistant writes them. */
function messagesOf(value: unknown, roles: string[]): { role: string; content: string }[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const messages = value.map((message) =>
    isObject(message) && isText(message.role) && roles.includes(message.role) && isText(message.content)
      ? { role: message.role, content: message.content }
      : undefined,
  );
  return messages.every((message) => message !== undefined) ? messages : undefined;
}

/**
 * Claude's request rebuilt with only what the assistant sends: one of its
 * models, at most `MAX_TOKENS`, text messages, and its structured output, so
 * the site's key pays for nothing else, such as tools or a bigger answer.
 */
function claudeBody(body: Json): Json | undefined {
  const { model, max_tokens, system, messages, output_config, fallbacks, stream } = body;
  if (!isText(model) || !CLAUDE_MODELS.includes(model)) return undefined;
  if (typeof max_tokens !== "number" || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_TOKENS)
    return undefined;
  const sent = messagesOf(messages, ["user", "assistant"]);
  if (!sent || (system !== undefined && !isText(system))) return undefined;
  if (!isObject(output_config) || !isObject(output_config.format)) return undefined;
  const { format, effort } = output_config;
  if (format.type !== "json_schema" || !isObject(format.schema)) return undefined;
  if (effort !== undefined && effort !== "low" && effort !== "medium") return undefined;
  if (fallbacks !== undefined && fallbacks !== "default") return undefined;
  if (stream !== undefined && typeof stream !== "boolean") return undefined;
  return {
    model,
    max_tokens,
    ...(system !== undefined && { system }),
    messages: sent,
    output_config: { format: { type: "json_schema", schema: format.schema }, ...(effort && { effort }) },
    ...(fallbacks && { fallbacks }),
    ...(stream !== undefined && { stream }),
  };
}

/** An OpenAI-compatible request rebuilt with only what the assistant sends: a model, text messages, and JSON answers. */
function chatBody(body: Json, models: string[] | undefined): Json | undefined {
  const { model, messages, response_format: format } = body;
  if (!isText(model) || model.length > 200 || (models && !models.includes(model))) return undefined;
  const sent = messagesOf(messages, ["system", "user"]);
  if (!sent || !isObject(format)) return undefined;
  if (format.type === "json_object") return { model, messages: sent, response_format: { type: "json_object" } };
  const schema = format.json_schema;
  if (format.type !== "json_schema" || !isObject(schema) || !isText(schema.name) || !isObject(schema.schema))
    return undefined;
  return {
    model,
    messages: sent,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        schema: schema.schema,
        ...(typeof schema.strict === "boolean" && { strict: schema.strict }),
      },
    },
  };
}

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

    let body: string | undefined;
    if (request.method !== "GET") {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_REQUEST_BYTES) return problem(413, "That request is too large.");
      let sent: unknown;
      try {
        sent = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        sent = undefined;
      }
      const rebuilt = !isObject(sent)
        ? undefined
        : service === "anthropic"
          ? claudeBody(sent)
          : chatBody(sent, typeof value === "object" ? value.models : undefined);
      if (!rebuilt) return problem(400, "The AI assistant doesn't ask for that.");
      body = JSON.stringify(rebuilt);
    }
    const headers = new Headers();
    for (const header of FORWARDED_HEADERS) {
      const value = request.headers.get(header);
      if (value) headers.set(header, value);
    }
    if (body) headers.set("content-type", "application/json");
    const betas = (request.headers.get("anthropic-beta") ?? "")
      .split(",")
      .map((beta) => beta.trim())
      .filter((beta) => ANTHROPIC_BETAS.has(beta));
    if (service === "anthropic" && betas.length > 0) headers.set("anthropic-beta", betas.join(","));
    if (key) {
      if (service === "anthropic") headers.set("x-api-key", key);
      else headers.set("authorization", `Bearer ${key}`);
    }
    // Anthropic's SDK marks beta requests with `?beta=true`; nothing else in the address is sent on.
    const search =
      service === "anthropic" && new URL(request.url).searchParams.get("beta") === "true" ? "?beta=true" : "";
    const target = `${trimChars(base, "/", { start: false })}/${path}${search}`;
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
