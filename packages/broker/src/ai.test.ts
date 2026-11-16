import { describe, expect, it } from "vitest";
import { brokerAi } from "./ai.js";

describe("the broker's AI requests", () => {
  it("tell Anthropic they come from a browser, which it answers only then", async () => {
    const sent: Request[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(input, init));
      return Response.json({ content: [] });
    }) as typeof fetch;
    const request = new Request("https://broker.invalid/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: "Hello" }],
        output_config: { format: { type: "json_schema", schema: { type: "object" } } },
      }),
    });
    const answer = await brokerAi({ anthropic: "sk-ant-editor" }, { fetch: fetcher }).forward(
      request,
      "anthropic",
      "v1/messages",
    );
    expect(answer.status).toBe(200);
    expect(sent[0]?.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(sent[0]?.headers.get("x-api-key")).toBe("sk-ant-editor");
  });
});
