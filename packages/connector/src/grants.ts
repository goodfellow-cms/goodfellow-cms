/**
 * The connector's only stored state: for each connection, which refresh
 * token is the current one (by generation, never the token itself) and when
 * it lapses. Kept in D1, Cloudflare's SQL database.
 */

/**
 * How long the refresh token before the current one still works, so Claude
 * asking again after an answer it didn't get (a slow network, a retry) doesn't
 * end the connection.
 */
export const REFRESH_GRACE_MS = 60_000;

/** What using a refresh token did: moved the connection on, used the one before within the grace period, or neither. */
export type Rotation = "rotated" | "repeated" | false;

export interface GrantStore {
  /** Records a new connection. `false` if there's one by that id already, as when a code is used twice. */
  create(id: string, expires: number, now: number): Promise<boolean>;
  /**
   * Moves a connection on from `generation`, if that's its current one and it
   * hasn't lapsed; or says `repeated` if it's the one before, moved on from
   * less than `REFRESH_GRACE_MS` ago.
   */
  rotate(id: string, generation: number, expires: number, now: number): Promise<Rotation>;
  /** Ends a connection. */
  revoke(id: string): Promise<void>;
  /** Whether a connection hasn't ended or lapsed, which every request with its access tokens checks. */
  active(id: string, now: number): Promise<boolean>;
}

/** The part of D1's binding the connector uses. */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first(): Promise<unknown>;
    };
  };
}

export function d1Grants(db: D1Like): GrantStore {
  return {
    async create(id, expires, now) {
      // Lapsed connections are cleared as new ones arrive, so the table stays small.
      await db.prepare("DELETE FROM grants WHERE expires_at < ?").bind(now).run();
      const result = await db
        .prepare(
          "INSERT INTO grants (id, generation, expires_at, rotated_at) VALUES (?, 1, ?, 0) ON CONFLICT (id) DO NOTHING",
        )
        .bind(id, expires)
        .run();
      return result.meta.changes === 1;
    },
    async rotate(id, generation, expires, now) {
      const result = await db
        .prepare(
          "UPDATE grants SET generation = generation + 1, expires_at = ?, rotated_at = ? WHERE id = ? AND generation = ? AND expires_at > ?",
        )
        .bind(expires, now, id, generation, now)
        .run();
      if (result.meta.changes === 1) return "rotated";
      const repeated = await db
        .prepare("SELECT 1 FROM grants WHERE id = ? AND generation = ? AND rotated_at > ? AND expires_at > ?")
        .bind(id, generation + 1, now - REFRESH_GRACE_MS, now)
        .first();
      return repeated === null ? false : "repeated";
    },
    async revoke(id) {
      await db.prepare("DELETE FROM grants WHERE id = ?").bind(id).run();
    },
    async active(id, now) {
      return (await db.prepare("SELECT 1 FROM grants WHERE id = ? AND expires_at > ?").bind(id, now).first()) !== null;
    },
  };
}

/** The same in memory, for tests. */
export function memoryGrants(): GrantStore & {
  rows: Map<string, { generation: number; expires: number; rotated: number }>;
} {
  const rows = new Map<string, { generation: number; expires: number; rotated: number }>();
  return {
    rows,
    async create(id, expires, now) {
      for (const [key, row] of rows) if (row.expires < now) rows.delete(key);
      if (rows.has(id)) return false;
      rows.set(id, { generation: 1, expires, rotated: 0 });
      return true;
    },
    async rotate(id, generation, expires, now) {
      const row = rows.get(id);
      if (!row || row.expires <= now) return false;
      if (row.generation === generation) {
        rows.set(id, { generation: generation + 1, expires, rotated: now });
        return "rotated";
      }
      return row.generation === generation + 1 && row.rotated > now - REFRESH_GRACE_MS ? "repeated" : false;
    },
    async revoke(id) {
      rows.delete(id);
    },
    async active(id, now) {
      const row = rows.get(id);
      return row !== undefined && row.expires > now;
    },
  };
}
