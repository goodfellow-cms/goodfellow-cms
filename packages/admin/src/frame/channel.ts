/**
 * Requests and events between the admin panel and a frame running the site's
 * code, over one `MessagePort`. The admin panel's side treats everything a
 * frame sends as untrusted: the site's blocks run there, and could send anything.
 */

/** The message the admin panel's page sends a frame once it has loaded, with the port to talk on. */
export const CONNECT_MESSAGE = "goodfellow:connect";

type Handler = (params: never) => unknown;
type Handlers = Record<string, Handler>;

type Message =
  | { type: "request"; id: number; method: string; params: unknown }
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "event"; name: string; payload: unknown };

/** A request the other side refused or couldn't answer. */
export class ChannelError extends Error {
  override name = "ChannelError";
}

export interface Channel {
  /** Asks the other side, which answers with what its handler for `method` returns. */
  call<T = unknown>(method: string, params?: unknown, transfer?: Transferable[]): Promise<T>;
  /** Tells the other side something, with no answer. */
  emit(name: string, payload?: unknown): void;
  /** Listens for one kind of event; returns a function that stops listening. */
  on(name: string, listener: (payload: unknown) => void): () => void;
  /** Answers requests for `method`. A request with no handler is refused. */
  handle(method: string, handler: Handler): () => void;
  close(): void;
}

function isMessage(data: unknown): data is Message {
  if (typeof data !== "object" || data === null) return false;
  const type = (data as { type?: unknown }).type;
  return type === "request" || type === "response" || type === "event";
}

/** What an error says, as text: errors can't cross the port as they are. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createChannel(port: MessagePort, handlers: Handlers = {}): Channel {
  const own: Handlers = { ...handlers };
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let next = 1;
  let closed = false;

  port.onmessage = async (event: MessageEvent) => {
    const message = event.data;
    if (!isMessage(message)) return;
    if (message.type === "response") {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.result);
      else waiting.reject(new ChannelError(message.error));
      return;
    }
    if (message.type === "event") {
      for (const listener of listeners.get(message.name) ?? []) listener(message.payload);
      return;
    }
    const handler =
      typeof message.method === "string" ? Object.hasOwn(own, message.method) && own[message.method] : undefined;
    if (!handler) {
      port.postMessage({ type: "response", id: message.id, ok: false, error: `No such request: ${message.method}` });
      return;
    }
    try {
      const result = await (handler as (params: unknown) => unknown)(message.params);
      if (!closed) port.postMessage({ type: "response", id: message.id, ok: true, result });
    } catch (error) {
      if (!closed) port.postMessage({ type: "response", id: message.id, ok: false, error: errorText(error) });
    }
  };

  return {
    call(method, params, transfer = []) {
      if (closed) return Promise.reject(new ChannelError("The frame has closed."));
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        port.postMessage({ type: "request", id, method, params }, transfer);
      });
    },
    emit(name, payload) {
      if (!closed) port.postMessage({ type: "event", name, payload });
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    handle(method, handler) {
      own[method] = handler;
      return () => {
        if (own[method] === handler) delete own[method];
      };
    },
    close() {
      closed = true;
      port.close();
      for (const waiting of pending.values()) waiting.reject(new ChannelError("The frame has closed."));
      pending.clear();
    },
  };
}
