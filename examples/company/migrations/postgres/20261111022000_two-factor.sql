-- Written by scripts/emit-migrations.ts from lib/db/migrations/20261111022000_two-factor.ts.
alter table "user" add column "twoFactorEnabled" boolean;
create table "twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);
create index "twoFactor_secret_idx" on "twoFactor" ("secret");
create index "twoFactor_userId_idx" on "twoFactor" ("userId");
