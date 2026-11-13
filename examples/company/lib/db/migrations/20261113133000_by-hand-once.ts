// At most one subscription given by hand a person (`BY_HAND` in lib/entitlements.ts), held by the database, so two
// admins giving someone one at the same moment can't leave them two. Paid subscriptions aren't limited.
import { type Kysely, sql } from "kysely";

const BY_HAND = sql<boolean>`"kind" = 'subscription' and "reference" = 'by-hand'`;

/** This migration's statements, in order. */
export function statements(db: Kysely<unknown>) {
  return [
    // Where someone has more than one already, the newest stays, as giving one by hand leaves it.
    {
      compile: () =>
        sql`delete from "entitlement" where ${BY_HAND} and exists (select 1 from "entitlement" as "newer" where "newer"."userId" = "entitlement"."userId" and "newer"."kind" = 'subscription' and "newer"."reference" = 'by-hand' and ("newer"."createdAt" > "entitlement"."createdAt" or ("newer"."createdAt" = "entitlement"."createdAt" and "newer"."id" > "entitlement"."id")))`.compile(
          db,
        ),
    },
    db.schema.createIndex("entitlement_by_hand_idx").on("entitlement").column("userId").unique().where(BY_HAND),
  ];
}
