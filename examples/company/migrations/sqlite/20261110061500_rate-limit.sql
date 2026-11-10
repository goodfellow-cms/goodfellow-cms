-- Written by scripts/emit-migrations.ts from lib/db/migrations/20261110061500_rate-limit.ts.
create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
