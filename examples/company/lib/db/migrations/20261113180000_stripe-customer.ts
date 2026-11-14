// The Stripe customer each person pays as (`stripeCustomerId`, lib/stripe.ts), so Stripe's portal opens for them
// whatever they bought has ended, and their later Checkout Sessions use the same customer.
import type { Kysely } from "kysely";

/** This migration's statements, in order. */
export function statements(db: Kysely<unknown>) {
  return [db.schema.alterTable("user").addColumn("stripeCustomerId", "text")];
}
