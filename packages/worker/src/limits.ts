/**
 * Daily limits on how often the worker is used: for each editor, each site and
 * overall, so one site can't use up everyone's share and the worker stays
 * within Cloudflare's free plan. Counts are kept in a Durable Object, which
 * sees every request in order, and start again at midnight UTC.
 */

/** A count to take, and the most it may reach today. */
export type Limit = [key: string, max: number];

export interface Limiter {
  /** Counts one use against every limit, unless one is reached already: then nothing is counted and its key is returned. */
  take(limits: readonly Limit[]): Promise<string | undefined>;
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Counts kept in memory, for tests and for a worker running on its own computer. */
export function memoryLimiter(now: () => number = Date.now): Limiter {
  let day = "";
  const counts = new Map<string, number>();
  return {
    async take(limits) {
      if (day !== today(now())) {
        day = today(now());
        counts.clear();
      }
      const over = limits.find(([key, max]) => (counts.get(key) ?? 0) >= max);
      if (over) return over[0];
      for (const [key] of limits) counts.set(key, (counts.get(key) ?? 0) + 1);
      return undefined;
    },
  };
}

/** The parts of a Durable Object's storage that `Limits` uses. */
interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  get<T>(keys: string[]): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  deleteAll(): Promise<void>;
}

/** The Durable Object that keeps the counts, bound to the worker as `LIMITS`. */
export class Limits {
  private readonly storage: Storage;

  constructor(state: { storage: Storage }) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { limits } = (await request.json()) as { limits: Limit[] };
    const day = today(Date.now());
    if ((await this.storage.get<string>("day")) !== day) {
      await this.storage.deleteAll();
      await this.storage.put({ day });
    }
    const counts = await this.storage.get<number>(limits.map(([key]) => `count:${key}`));
    const over = limits.find(([key, max]) => (counts.get(`count:${key}`) ?? 0) >= max);
    if (over) return Response.json({ over: over[0] });
    await this.storage.put(
      Object.fromEntries(limits.map(([key]) => [`count:${key}`, (counts.get(`count:${key}`) ?? 0) + 1])),
    );
    return Response.json({});
  }
}

/** The parts of a Durable Object namespace binding that the worker uses. */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/** Counts kept by the `Limits` Durable Object: one for the whole worker, so every request sees the same counts. */
export function durableLimiter(namespace: DurableObjectNamespaceLike): Limiter {
  return {
    async take(limits) {
      const stub = namespace.get(namespace.idFromName("limits"));
      const response = await stub.fetch("https://limits/take", { method: "POST", body: JSON.stringify({ limits }) });
      const { over } = (await response.json()) as { over?: string };
      return over;
    },
  };
}
