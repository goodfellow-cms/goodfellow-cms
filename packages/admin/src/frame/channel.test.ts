import { afterEach, describe, expect, it } from "vitest";
import { type Channel, ChannelError, createChannel } from "./channel.js";

const open: Channel[] = [];

function pair(handlers: Parameters<typeof createChannel>[1] = {}) {
  const { port1, port2 } = new MessageChannel();
  const page = createChannel(port1);
  const frame = createChannel(port2, handlers);
  open.push(page, frame);
  return { page, frame };
}

afterEach(() => {
  for (const channel of open.splice(0)) channel.close();
});

describe("createChannel", () => {
  it("answers requests with what their handler returns, awaited", async () => {
    const { page } = pair({ double: (n: number) => n * 2, later: async (text: string) => `${text}!` });
    await expect(page.call("double", 21)).resolves.toBe(42);
    await expect(page.call("later", "ready")).resolves.toBe("ready!");
  });

  it("refuses requests nobody handles, including the names objects already have", async () => {
    const { page } = pair();
    await expect(page.call("nothing")).rejects.toThrow(new ChannelError("No such request: nothing"));
    await expect(page.call("toString")).rejects.toThrow("No such request: toString");
  });

  it("sends a handler's error as its message", async () => {
    const { page } = pair({
      fail: () => {
        throw new Error("It didn't work.");
      },
    });
    await expect(page.call("fail")).rejects.toThrow(new ChannelError("It didn't work."));
  });

  it("handles requests added later, until they're stopped", async () => {
    const { page, frame } = pair();
    const stop = frame.handle("hello", () => "hi");
    await expect(page.call("hello")).resolves.toBe("hi");
    stop();
    await expect(page.call("hello")).rejects.toThrow("No such request: hello");
  });

  it("delivers events to their listeners", async () => {
    const { page, frame } = pair();
    const received = new Promise((resolve) => page.on("state", resolve));
    frame.emit("state", { past: true });
    await expect(received).resolves.toEqual({ past: true });
  });

  it("rejects what's waiting when it closes", async () => {
    const { page } = pair({ never: () => new Promise(() => {}) });
    const waiting = page.call("never");
    page.close();
    await expect(waiting).rejects.toThrow("The frame has closed.");
    await expect(page.call("never")).rejects.toThrow("The frame has closed.");
  });

  it("ignores messages that aren't its own", async () => {
    const { port1, port2 } = new MessageChannel();
    const page = createChannel(port1, { ping: () => "pong" });
    open.push(page);
    port2.postMessage("not a request");
    port2.postMessage({ type: "response", id: 99, ok: true, result: 1 });
    const answer = new Promise((resolve) => {
      port2.onmessage = (event) => resolve(event.data);
    });
    port2.postMessage({ type: "request", id: 1, method: "ping" });
    await expect(answer).resolves.toEqual({ type: "response", id: 1, ok: true, result: "pong" });
    port2.close();
  });
});
