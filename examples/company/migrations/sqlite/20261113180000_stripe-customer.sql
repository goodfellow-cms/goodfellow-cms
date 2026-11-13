-- Written by scripts/emit-migrations.ts from lib/db/migrations/20261113180000_stripe-customer.ts.
alter table "user" add column "stripeCustomerId" text;
