/**
 * The connector's only stored state: for each connection, which refresh
 * token is the current one (by generation, never the token itself) and when
 * it lapses. Kept in D1, Cloudflare's SQL database.
 */

export interface GrantStore {
  /** Records a new connection. `false` if there's one by that id already, as when a code is used twice. */
  create(id: string, expires: number, now: number): Promise<boolean>;
  /** Moves a connection on from `generation`, if that's its current one and it hasn't lapsed. */
  rotate(id: string, generation: number, expires: number, now: number): Promise<boolean>;
  /** Ends a connection. */
  revoke(id: string): Promise<void>;
}

/** The part of D1's binding the connector uses. */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<{ meta: { changes: number } }> };
  };
}

export function d1Grants(db: D1Like): GrantStore {
  return {
    async create(id, expires, now) {
      // Lapsed connections are cleared as new ones arrive, so the table stays small.
      await db.prepare("DELETE FROM grants WHERE expires_at < ?").bind(now).run();
      const result = await db
        .prepare("INSERT INTO grants (id, generation, expires_at) VALUES (?, 1, ?) ON CONFLICT (id) DO NOTHING")
        .bind(id, expires)
        .run();
      return result.meta.changes === 1;
    },
    async rotate(id, generation, expires, now) {
      const result = await db
        .prepare(
          "UPDATE grants SET generation = generation + 1, expires_at = ? WHERE id = ? AND generation = ? AND expires_at > ?",
        )
        .bind(expires, id, generation, now)
        .run();
      return result.meta.changes === 1;
    },
    async revoke(id) {
      await db.prepare("DELETE FROM grants WHERE id = ?").bind(id).run();
    },
  };
}

/** The same in memory, for tests. */
export function memoryGrants(): GrantStore & { rows: Map<string, { generation: number; expires: number }> } {
  const rows = new Map<string, { generation: number; expires: number }>();
  return {
    rows,
    async create(id, expires, now) {
      for (const [key, row] of rows) if (row.expires < now) rows.delete(key);
      if (rows.has(id)) return false;
      rows.set(id, { generation: 1, expires });
      return true;
    },
    async rotate(id, generation, expires, now) {
      const row = rows.get(id);
      if (!row || row.generation !== generation || row.expires <= now) return false;
      rows.set(id, { generation: generation + 1, expires });
      return true;
    },
    async revoke(id) {
      rows.delete(id);
    },
  };
}
