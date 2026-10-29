import { describe, expect, it } from "vitest";
import { buildRequest, manualPrompt, parseAnswer, type SiteSummary } from "./prompt.js";
import { AiError, listModels, redact, runRequest } from "./providers.js";
import { fakeAi } from "./testing.js";

const site: SiteSummary = {
  title: "St. Joseph",
  description: "A parish in Anytown",
  language: "en",
  pages: [{ path: "/", title: "Home" }],
  collections: [],
  images: ["/media/church.jpg"],
  contact: { phone: "(555) 010-0100", email: "" },
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

describe("buildRequest", () => {
  it("tells the AI about the site and the task", () => {
    expect(request.prompt).toContain('The site is "St. Joseph": A parish in Anytown.');
    expect(request.prompt).toContain('/ ("Home")');
    expect(request.prompt).toContain("A welcome heading");
    expect(request.prompt).toContain("Images in its media library, which image fields can use: /media/church.jpg.");
    expect(request.prompt).toContain(
      'Its contact details, which a Contact details block shows: phone "(555) 010-0100".',
    );
    expect(request.system).toContain("Never invent facts");
  });

  it("spells out the format for chat apps, and reads their answers", () => {
    expect(manualPrompt(request)).toContain('"blocks"');
    expect(parseAnswer('Here you go:\n```json\n{"blocks": []}\n```')).toEqual({ blocks: [] });
    expect(() => parseAnswer("Sorry, I can't.")).toThrow(SyntaxError);
  });
});

describe("runRequest", () => {
  it("asks Claude with structured outputs and safety fallbacks, streaming the answer", async () => {
    const fake = fakeAi({ answer: () => answer, keys: ["sk-ant-test"] });
    let progress = 0;
    const result = await runRequest(
      { provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-test" },
      request,
      { fetch: fake.fetch, onProgress: (characters) => (progress = characters) },
    );

    expect(result).toEqual(answer);
    expect(progress).toBe(JSON.stringify(answer).length);
    const sent = fake.requests[0];
    expect(sent?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(sent?.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(sent?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(sent?.body).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      fallbacks: "default",
      output_config: { format: { type: "json_schema" }, effort: "medium" },
    });
  });

  it("leaves out effort and fallbacks for Claude Haiku", async () => {
    const fake = fakeAi({ answer: () => answer });
    await runRequest({ provider: "anthropic", model: "claude-haiku-4-5", apiKey: "k" }, request, { fetch: fake.fetch });
    expect(fake.requests[0]?.body).not.toHaveProperty("fallbacks");
    expect(fake.requests[0]?.body.output_config).not.toHaveProperty("effort");
  });

  it("explains a wrong key without repeating it", async () => {
    const fake = fakeAi({ answer: () => answer, keys: ["right"] });
    const error = await runRequest(
      { provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-wrong-key-123456789" },
      request,
      { fetch: fake.fetch },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).problem).toBe("key");
    expect((error as AiError).message).not.toContain("sk-ant-wrong-key");
  });

  it("asks OpenAI-compatible services for JSON, with no key where none is needed", async () => {
    const fake = fakeAi({ answer: () => answer, models: ["gpt-oss-120b", "a-model"] });
    const settings = { provider: "ovhcloud" as const, model: "gpt-oss-120b" };
    expect(await runRequest(settings, request, { fetch: fake.fetch })).toEqual(answer);
    const sent = fake.requests[0];
    expect(sent?.url).toBe("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions");
    expect(sent?.headers.get("authorization")).toBeNull();
    expect(sent?.body.response_format).toEqual({ type: "json_object" });
    expect(String((sent?.body.messages as Array<{ content: string }> | undefined)?.[1]?.content)).toContain(
      "JSON Schema",
    );
    expect(await listModels(settings, { fetch: fake.fetch })).toEqual(["a-model", "gpt-oss-120b"]);
  });

  it("sends a key only over HTTPS, unless the service runs on this computer", async () => {
    const fake = fakeAi({ answer: () => answer, models: ["local"] });
    const custom = (baseUrl: string) => ({ provider: "custom" as const, model: "m", apiKey: "sk-test", baseUrl });
    await expect(listModels(custom("http://ai.example/v1"), { fetch: fake.fetch })).rejects.toThrow(/https:\/\//);
    expect(fake.requests).toEqual([]);
    expect(await listModels(custom("http://localhost:11434/v1"), { fetch: fake.fetch })).toEqual(["local"]);
  });

  it("holds services that can follow a schema to it", async () => {
    const fake = fakeAi({ answer: () => answer, keys: ["sk-test"] });
    await runRequest({ provider: "openai", model: "gpt-x", apiKey: "sk-test" }, request, { fetch: fake.fetch });
    const sent = fake.requests[0];
    expect(sent?.headers.get("authorization")).toBe("Bearer sk-test");
    expect(sent?.body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("needs a key for services that require one", async () => {
    await expect(runRequest({ provider: "openai", model: "gpt-x" }, request)).rejects.toMatchObject({ problem: "key" });
  });
});

describe("redact", () => {
  it("hides keys in error messages", () => {
    expect(redact("Incorrect API key provided: sk-proj-abcdef1234567890", undefined)).toBe(
      "Incorrect API key provided: [key]",
    );
    expect(redact("bad key mykey!", "mykey!")).toBe("bad key [key]");
  });
});
