import { APP_API_HEADER, trimChars } from "@goodfellow-cms/core";
import { type AiRequest, parseAnswer } from "./prompt.js";

/** The AI services the assistant can use. Every one is called straight from the editor's browser. */
export const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "groq",
  "mistral",
  "openrouter",
  "ovhcloud",
  "custom",
  "manual",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  /** The service's name. Brand names aren't translated, so they're kept here rather than in the admin panel's text. */
  name: string;
  /** Where to create an API key, for services that need one. */
  keyUrl?: string;
  needsKey: boolean;
  /** For services with an OpenAI-compatible API. */
  baseUrl?: string;
  /** Whether the service can be held to a JSON Schema, or only asked for JSON. */
  structured?: "json_schema" | "json_object";
  /** Models to offer before the service has been asked for its list. */
  models?: string[];
}

/** Claude models, best first. */
export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    name: "Claude",
    keyUrl: "https://platform.claude.com/settings/keys",
    needsKey: true,
    models: CLAUDE_MODELS,
  },
  openai: {
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    baseUrl: "https://api.openai.com/v1",
    structured: "json_schema",
  },
  gemini: {
    name: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    structured: "json_schema",
  },
  groq: {
    name: "Groq",
    keyUrl: "https://console.groq.com/keys",
    needsKey: true,
    baseUrl: "https://api.groq.com/openai/v1",
    structured: "json_object",
  },
  mistral: {
    name: "Mistral",
    keyUrl: "https://console.mistral.ai/api-keys",
    needsKey: true,
    baseUrl: "https://api.mistral.ai/v1",
    structured: "json_schema",
  },
  openrouter: {
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    needsKey: true,
    baseUrl: "https://openrouter.ai/api/v1",
    structured: "json_schema",
  },
  ovhcloud: {
    name: "OVHcloud AI Endpoints",
    needsKey: false,
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    structured: "json_object",
    models: ["gpt-oss-120b"],
  },
  custom: { name: "OpenAI-compatible", needsKey: false, structured: "json_object" },
  manual: { name: "Chat app", needsKey: false },
};

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  /** The editor's own key. Only ever sent to the provider's API. */
  apiKey?: string;
  /** For `custom`: the API's address, such as `https://example.org/v1`. */
  baseUrl?: string;
  /**
   * The full address of a full-stack site's AI requests, such as
   * `https://example.org/api/goodfellow/ai`, where its server has a key for the
   * service. Requests go there instead, with no key, and the server adds its own.
   */
  server?: string;
}

export type AiProblem =
  /** The key is missing, wrong or not allowed to use the model. */
  | "key"
  /** Too many requests, or the account has run out of credit. */
  | "limit"
  /** The service couldn't be reached. */
  | "network"
  /** The service declined the request. */
  | "refused"
  /** The answer was cut off or couldn't be read. */
  | "answer"
  /** Anything else the service reported. */
  | "service";

/** Something went wrong asking the AI. `problem` says what, for the admin panel to explain. */
export class AiError extends Error {
  override name = "AiError";

  constructor(
    readonly problem: AiProblem,
    message: string,
  ) {
    super(message);
  }
}

/** Removes the key, and anything else that looks like one, from text shown to the editor. */
export function redact(text: string, key?: string): string {
  let result = key ? text.split(key).join("[key]") : text;
  result = result.replace(/\b(sk|gsk|AIza)[-_A-Za-z0-9]{12,}/g, "[key]");
  return result;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Called as the answer arrives, with how much has been written so far. */
  onProgress?: (characters: number) => void;
  /** Replaces `fetch`, for tests. */
  fetch?: typeof fetch;
}

function readJson(text: string): unknown {
  try {
    return parseAnswer(text);
  } catch (error) {
    throw new AiError("answer", `The answer wasn't valid JSON: ${(error as Error).message}`);
  }
}

/** Claude, through Anthropic's official SDK, with the answer held to the schema by structured outputs. */
async function runClaude(settings: ProviderSettings, request: AiRequest, options: RunOptions): Promise<unknown> {
  // Loaded only when Claude is used, so the SDK doesn't add to the editor's load time.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({
    // The site's server replaces this with its own key.
    apiKey: settings.server ? "server" : settings.apiKey,
    // The key is the editor's own, typed into their own browser, or the site's server's, which never reaches it.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(settings.server && {
      baseURL: `${trimChars(settings.server, "/", { start: false })}/anthropic`,
      defaultHeaders: { [APP_API_HEADER]: "1" },
    }),
    ...(options.fetch && { fetch: options.fetch }),
  });
  const current = settings.model === "claude-opus-5-5" || settings.model === "claude-sonnet-5-5";

  try {
    const stream = client.beta.messages.stream(
      {
        model: settings.model,
        max_tokens: 64000,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          format: { type: "json_schema", schema: request.schema },
          // Haiku 4.5 doesn't take an effort level.
          ...(current && { effort: request.effort }),
        },
        // If a safety check declines the request, Anthropic retries it on the model it recommends.
        ...(current && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      },
      { signal: options.signal },
    );
    stream.on("text", (_delta, snapshot) => options.onProgress?.(snapshot.length));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new AiError("refused", message.stop_details?.explanation ?? "Claude declined this request.");
    }
    if (message.stop_reason === "max_tokens") throw new AiError("answer", "The answer was too long and was cut off.");
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return readJson(text);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Anthropic.APIUserAbortError) throw error;
    const message = redact((error as Error).message ?? String(error), settings.apiKey);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("key", message);
    }
    if (error instanceof Anthropic.NotFoundError) throw new AiError("key", message);
    if (error instanceof Anthropic.RateLimitError) throw new AiError("limit", message);
    if (error instanceof Anthropic.APIConnectionError) throw new AiError("network", message);
    throw new AiError("service", message);
  }
}

function baseUrlOf(settings: ProviderSettings): string {
  if (settings.server) return `${trimChars(settings.server, "/", { start: false })}/${settings.provider}`;
  const base = settings.provider === "custom" ? settings.baseUrl : PROVIDERS[settings.provider].baseUrl;
  if (!base) throw new AiError("service", "No address is set for this AI service.");
  // The key goes with every request, so only over HTTPS, unless the service runs on this computer.
  if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(base)) {
    throw new AiError("service", "The AI service's address must start with https://, unless it runs on this computer.");
  }
  return trimChars(base, "/", { start: false });
}

function headersFor(settings: ProviderSettings): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(settings.server
      ? { [APP_API_HEADER]: "1" }
      : settings.apiKey && { Authorization: `Bearer ${settings.apiKey}` }),
  };
}

async function failure(response: Response, settings: ProviderSettings): Promise<AiError> {
  const body = redact((await response.text().catch(() => "")).slice(0, 2000), settings.apiKey);
  const message = `${response.status} ${response.statusText}${body ? `: ${body}` : ""}`;
  if (response.status === 401 || response.status === 403) return new AiError("key", message);
  if (response.status === 402 || response.status === 429) return new AiError("limit", message);
  return new AiError("service", message);
}

async function send(url: string, init: RequestInit, options: RunOptions): Promise<Response> {
  try {
    return await (options.fetch ?? fetch)(url, { ...init, signal: options.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AiError("network", (error as Error).message);
  }
}

/** Services with an OpenAI-compatible chat API: OpenAI itself, Gemini, Groq, Mistral, OpenRouter, OVHcloud and others. */
async function runOpenAiCompatible(
  settings: ProviderSettings,
  request: AiRequest,
  options: RunOptions,
): Promise<unknown> {
  const info = PROVIDERS[settings.provider];
  const ask = async (format: "json_schema" | "json_object") => {
    const prompt =
      format === "json_schema"
        ? request.prompt
        : `${request.prompt}\n\nAnswer with a single JSON object matching this JSON Schema:\n${JSON.stringify(request.schema)}`;
    return send(
      `${baseUrlOf(settings)}/chat/completions`,
      {
        method: "POST",
        headers: headersFor(settings),
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: prompt },
          ],
          response_format:
            format === "json_schema"
              ? { type: "json_schema", json_schema: { name: "answer", schema: request.schema, strict: true } }
              : { type: "json_object" },
        }),
      },
      options,
    );
  };

  let response = await ask(info.structured ?? "json_object");
  // Not every model can be held to a schema. Asking for plain JSON still works, and the answer is checked anyway.
  if (response.status === 400 && info.structured === "json_schema") response = await ask("json_object");
  if (!response.ok) throw await failure(response, settings);

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("refused", choice.message.refusal);
  if (choice?.finish_reason === "length") throw new AiError("answer", "The answer was too long and was cut off.");
  const text = choice?.message?.content ?? "";
  options.onProgress?.(text.length);
  return readJson(text);
}

/** Asks the AI service for an answer to a request, as parsed JSON. Check it with `toContent` or `toValues` before use. */
export async function runRequest(
  settings: ProviderSettings,
  request: AiRequest,
  options: RunOptions = {},
): Promise<unknown> {
  if (settings.provider === "manual") {
    throw new AiError("service", "Chat apps are used by copying the request with manualPrompt().");
  }
  if (PROVIDERS[settings.provider].needsKey && !settings.apiKey && !settings.server) {
    throw new AiError("key", "No API key is set.");
  }
  if (!settings.model) throw new AiError("service", "No model is chosen.");
  return settings.provider === "anthropic"
    ? runClaude(settings, request, options)
    : runOpenAiCompatible(settings, request, options);
}

/** The models a service offers, for choosing one. Claude's are listed without asking. */
export async function listModels(settings: ProviderSettings, options: RunOptions = {}): Promise<string[]> {
  const info = PROVIDERS[settings.provider];
  if (settings.provider === "anthropic") return CLAUDE_MODELS;
  if (settings.provider === "manual") return [];
  if (info.needsKey && !settings.apiKey && !settings.server) return info.models ?? [];
  const response = await send(`${baseUrlOf(settings)}/models`, { headers: headersFor(settings) }, options);
  if (!response.ok) throw await failure(response, settings);
  const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const ids = (data.data ?? []).flatMap((model) => (typeof model.id === "string" ? [model.id] : []));
  return ids.sort((a, b) => a.localeCompare(b));
}
