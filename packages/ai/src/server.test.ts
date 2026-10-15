import { describe, expect, it } from "vitest";
import { buildRequest, type SiteSummary } from "./prompt.js";
import { listModels, runRequest } from "./providers.js";
import { aiServer } from "./server.js";
import { fakeAi } from "./testing.js";

const site: SiteSummary = {
  title: "St. Joseph",
  description: "A parish in Anytown",
  language: "en",
  pages: [{ path: "/", title: "Home" }],
  collections: [],
  images: [],
};

const config = {
  components: { Heading: { fields: { text: { type: "text" as const, label: "Text" } }, render: () => null } },
} as never;

const request = buildRequest(
  { kind: "add", page: { path: "/", title: "Home" }, content: [], instruction: "A welcome heading" },
  config,
  site,
);

const answer = { blocks: [{ type: "Heading", id: "b1", parent: null, slot: null, props: { text: "Welcome" } }] };

const SERVER = "https://parish.example/api/goodfellow/ai";

/** The site's server: the editor's browser calls it, and it calls the fake services with its own keys. */
function siteServer(keys: Parameters<typeof aiServer>[0]) {
  const fake = fakeAi({ answer: () => answer, keys: ["sk-ant-site", "sk-site"], models: ["gpt-5"] });
  const server = aiServer(keys, { fetch: fake.fetch });
  const browser = ((input: RequestInfo | URL, init?: RequestInit) => {
    const incoming = new Request(input, init);
    const [service = "", ...rest] = new URL(incoming.url).pathname.slice("/api/goodfellow/ai/".length).split("/");
    return server.forward(incoming, service, rest.join("/"));
  }) as typeof fetch;
  return { fake, server, browser };
}

describe("aiServer", () => {
  it("lists only the services it has keys for", () => {
    expect(aiServer({ anthropic: "sk-ant-site", openai: undefined, groq: "" }).services).toEqual(["anthropic"]);
    expect(aiServer({ custom: { baseUrl: "https://ai.example/v1" } }).services).toEqual(["custom"]);
  });

  it("asks Claude with the site's key, which the browser never has", async () => {
    const { fake, browser } = siteServer({ anthropic: "sk-ant-site" });
    const result = await runRequest({ provider: "anthropic", model: "claude-opus-5-5", server: SERVER }, request, {
      fetch: browser,
    });
    expect(result).toEqual(answer);
    const sent = fake.requests[0];
    expect(sent?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(sent?.headers.get("x-api-key")).toBe("sk-ant-site");
    expect(sent?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(sent?.headers.get("x-goodfellow-request")).toBeNull();
  });

  it("asks OpenAI-compatible services with the site's key, and lists their models", async () => {
    const { fake, browser } = siteServer({ openai: "sk-site" });
    const settings = { provider: "openai" as const, model: "gpt-5", server: SERVER };
    expect(await runRequest(settings, request, { fetch: browser })).toEqual(answer);
    expect(fake.requests[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(fake.requests[0]?.headers.get("authorization")).toBe("Bearer sk-site");
    expect(await listModels(settings, { fetch: browser })).toEqual(["gpt-5"]);
  });

  it("sends on only what the assistant uses, without the editor's cookies", async () => {
    const { fake, server } = siteServer({ anthropic: "sk-ant-site", openai: "sk-site" });
    const post = (service: string, path: string, headers: Record<string, string> = {}) =>
      server.forward(
        new Request(`${SERVER}/${service}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ model: "gpt-5", messages: [] }),
        }),
        service,
        path,
      );
    expect((await post("anthropic", "v1/files")).status).toBe(404);
    expect((await post("openai", "images/generations")).status).toBe(404);
    expect((await post("groq", "chat/completions")).status).toBe(404);
    expect(fake.requests).toHaveLength(0);

    await post("openai", "chat/completions", { cookie: "session=secret", authorization: "Bearer editor" });
    expect(fake.requests[0]?.headers.get("cookie")).toBeNull();
    expect(fake.requests[0]?.headers.get("authorization")).toBe("Bearer sk-site");
  });

  it("passes on the service's errors without its key", async () => {
    const server = aiServer(
      { openai: "sk-site-0123456789abcdef" },
      {
        fetch: (async () =>
          new Response("Bad key sk-site-0123456789abcdef", { status: 401 })) as unknown as typeof fetch,
      },
    );
    const response = await server.forward(new Request(`${SERVER}/openai/models`), "openai", "models");
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Bad key [key]");
  });
});
