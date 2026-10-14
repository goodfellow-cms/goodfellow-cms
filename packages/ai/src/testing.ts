/**
 * A fake of the AI services' APIs, for tests: Anthropic's Messages API (with
 * streaming) and the OpenAI-compatible chat API. Pass `fake.fetch` to
 * `runRequest`, or route browser requests to `fake.handle` in end-to-end tests.
 */

export interface FakeAiOptions {
  /** The JSON each request is answered with, given the request's body. */
  answer: (body: Record<string, unknown>) => unknown;
  /** Keys the fake accepts. Requests with any other key get a 401. */
  keys?: string[];
  /** Model ids `/models` lists for OpenAI-compatible services. */
  models?: string[];
}

function sse(events: Array<[string, unknown]>): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** A streamed Messages API response whose text is `text`, sent in a few pieces like the real API. */
function claudeStream(model: string, text: string): string {
  const pieces = text.match(/[\s\S]{1,40}/g) ?? [""];
  return sse([
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ...pieces.map((piece): [string, unknown] => [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } },
    ]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    ],
    ["message_stop", { type: "message_stop" }],
  ]);
}

export function fakeAi(options: FakeAiOptions) {
  const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];

  const unauthorized = () =>
    Response.json(
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      { status: 401 },
    );

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    requests.push({ url: request.url, headers: request.headers, body });
    const key = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (options.keys && !options.keys.includes(key ?? "")) return unauthorized();

    if (url.pathname.endsWith("/v1/messages")) {
      const answer = JSON.stringify(options.answer(body));
      const model = String(body.model);
      if (body.stream) {
        return new Response(claudeStream(model, answer), { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({
        id: "msg_fake",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: answer }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      return Response.json({
        id: "chatcmpl-fake",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(options.answer(body)) },
            finish_reason: "stop",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: (options.models ?? []).map((id) => ({ id, object: "model" })) });
    }
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  }

  return {
    requests,
    handle,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
  };
}

/** A photo as Openverse's search lists it, with only the fields Goodfellow reads. */
export interface FakeOpenversePhoto {
  id: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  source?: string;
  width?: number;
  height?: number;
}

export interface FakeOpenverseOptions {
  /** The photos a search finds, given its words. */
  photos: (query: string) => FakeOpenversePhoto[];
  /** What downloading a photo gives: a 1×1 PNG unless set. */
  image?: { bytes: Uint8Array; type: string };
  /** Answers every request as Openverse does when asked too often. */
  busy?: boolean;
}

/** A 1×1 PNG, the smallest image a browser reads. */
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (character) => character.charCodeAt(0),
);

/**
 * A fake of Openverse's API, for tests: its image search and its downloads of
 * photos at full size. Pass `fake.fetch`, or route browser requests to `fake.handle`.
 */
export function fakeOpenverse(options: FakeOpenverseOptions) {
  const requests: string[] = [];

  async function handle(request: Request): Promise<Response> {
    requests.push(request.url);
    const cors = { "access-control-allow-origin": "*" };
    if (options.busy) return Response.json({ detail: "Request was throttled." }, { status: 429, headers: cors });
    const url = new URL(request.url);
    if (/^\/v1\/images\/[^/]+\/thumb\/?$/.test(url.pathname)) {
      const image = options.image ?? { bytes: PIXEL, type: "image/png" };
      return new Response(image.bytes.slice().buffer, { headers: { ...cors, "content-type": image.type } });
    }
    if (/^\/v1\/images\/?$/.test(url.pathname)) {
      const results = options.photos(url.searchParams.get("q") ?? "").map((photo) => ({
        title: "",
        creator: "",
        license: "by",
        license_version: "4.0",
        source: "flickr",
        ...photo,
      }));
      return Response.json({ result_count: results.length, page_count: 1, results }, { headers: cors });
    }
    return Response.json({ detail: "Not found." }, { status: 404, headers: cors });
  }

  return {
    requests,
    handle,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
  };
}
