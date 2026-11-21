import { afterEach, describe, expect, it } from "vitest";
import {
  BROKER_AI_ADDRESS,
  type BrokerAiPort,
  type BrokerServiceAnswer,
  type BrokerServiceRequest,
  brokerAiAnswers,
  brokerAiFetch,
} from "./broker.js";

type Port = BrokerAiPort & { onmessage: ((event: { data: unknown }) => void) | null; close(): void };
type Channel = { port1: Port; port2: Port };
const { MessageChannel } = globalThis as unknown as { MessageChannel: new () => Channel };

const channels: Channel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The admin panel's fetch on one end of a channel, the broker's answers on the other, with `forward` as the service. */
function connect(forward: (request: Request) => Promise<Response>) {
  const channel = new MessageChannel();
  channels.push(channel);
  const answer = brokerAiAnswers(channel.port1, (request) => forward(request));
  channel.port1.onmessage = (event: { data: unknown }) => void answer(event.data as BrokerServiceRequest);
  return brokerAiFetch(channel.port2);
}

const ask = (fetcher: ReturnType<typeof brokerAiFetch>, signal?: AbortSignal) =>
  fetcher(`${BROKER_AI_ADDRESS}/anthropic/v1/messages`, { method: "POST", body: "{}", signal });

/** A body whose parts the test sends one at a time. */
function controlled() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(made) {
      controller = made;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: () => controller.error(new Error("connection reset")),
  };
}

describe("AI requests through the broker", () => {
  it("pass each part of the answer on as it arrives, before the answer is complete", async () => {
    const body = controlled();
    const response = await ask(connect(async () => new Response(body.stream, { status: 200 })));
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    body.send("event: one\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: one\n\n");
    body.send("event: two\n\n");
    body.end();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: two\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("fail in the admin panel where the answer breaks off part-way, or the service can't be reached", async () => {
    const body = controlled();
    const response = await ask(connect(async () => new Response(body.stream)));
    body.send("partial");
    body.fail();
    await expect(response.text()).rejects.toThrow(/couldn't reach the AI service/);
    await expect(
      ask(
        connect(async () => {
          throw new TypeError("network down: sk-ant-secret");
        }),
      ),
    ).rejects.toThrow(/couldn't reach the AI service/);
    // What failed stays in the broker: not even the service's message reaches the admin panel.
    await expect(
      ask(
        connect(async () => {
          throw new TypeError("network down: sk-ant-secret");
        }),
      ),
    ).rejects.not.toThrow(/sk-ant-secret/);
  });

  it("stop the broker's request when the admin panel stops it, before or after it starts", async () => {
    const stopped: AbortSignal[] = [];
    const fetcher = connect(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          stopped.push(request.signal);
          request.signal.addEventListener("abort", () => reject(request.signal.reason));
        }),
    );
    const stop = new AbortController();
    const asked = ask(fetcher, stop.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped[0]?.aborted).toBe(true);

    // And while its answer is arriving: cancelling the body stops it too.
    const body = controlled();
    let signal: AbortSignal | undefined;
    const streaming = connect(async (request) => {
      signal = request.signal;
      request.signal.addEventListener("abort", () => body.fail());
      return new Response(body.stream);
    });
    const response = await ask(streaming);
    body.send("first");
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signal?.aborted).toBe(true);
  });

  it("answer an admin panel from before streaming whole, with a 502 where it failed", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const answer = brokerAiAnswers(channel.port1, async (request) =>
      request.url.endsWith("/fail") ? Promise.reject(new Error("down")) : new Response("whole", { status: 201 }),
    );
    const answers: BrokerServiceAnswer[] = [];
    channel.port2.onmessage = (event: { data: unknown }) => answers.push(event.data as BrokerServiceAnswer);
    await answer({
      type: "ai",
      id: 1,
      path: "anthropic/v1/messages",
      method: "POST",
      headers: [],
      body: new ArrayBuffer(0),
    });
    await answer({ type: "ai", id: 2, path: "anthropic/fail", method: "GET", headers: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answers.map((each) => [each.type, "status" in each ? each.status : undefined])).toEqual([
      ["ai", 201],
      ["ai", 502],
    ]);
    expect(new TextDecoder().decode(new Uint8Array((answers[0] as { body: ArrayBuffer }).body))).toBe("whole");
  });

  it("take a whole answer from a broker from before streaming", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    channel.port1.onmessage = (event: { data: unknown }) => {
      const request = event.data as { id: number };
      const body = new TextEncoder().encode("done").buffer as ArrayBuffer;
      channel.port1.postMessage({ type: "ai", id: request.id, status: 200, headers: [], body } as unknown, [body]);
    };
    const response = await ask(brokerAiFetch(channel.port2));
    expect(await response.text()).toBe("done");
  });

  it("take a whole answer with no body, such as a 204, from a broker from before streaming", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    channel.port1.onmessage = (event: { data: unknown }) => {
      const request = event.data as { id: number };
      const body = new ArrayBuffer(0);
      channel.port1.postMessage({ type: "ai", id: request.id, status: 204, headers: [], body } as unknown, [body]);
    };
    const response = await ask(brokerAiFetch(channel.port2));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
