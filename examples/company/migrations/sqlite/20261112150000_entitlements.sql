-- Written by scripts/emit-migrations.ts from lib/db/migrations/20261112150000_entitlements.ts.
create table "entitlement" ("id" text not null primary key, "userId" text not null references "user" ("id") on delete cascade, "kind" text not null, "reference" text not null, "expiresAt" date, "createdAt" date not null);
create index "entitlement_userId_idx" on "entitlement" ("userId");
