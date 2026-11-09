# Company site

A full-stack website built with [Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) and [Next.js](https://nextjs.org), for an organization whose editors sign in with the site's own accounts rather than GitHub's. Pages are files in a content repository of their own, edited in the admin panel at `/admin`; the site's server publishes them for the editors and keeps accounts in a database.

It's being built in steps, and isn't released yet; the [full-stack Next.js](https://goodfellow-cms.github.io/goodfellow-cms/docs/full-stack-nextjs) docs page describes what it's built on. This step has the database and sign-in. Deploying it to Cloudflare, with a D1 database, comes next.

## Working on the site

<!-- goodfellow-repository -->
> **In the Goodfellow repository**, this folder is part of a pnpm workspace, so `npm install` doesn't work here. From the repository's root, run `pnpm install` and `pnpm build` (get pnpm with `npm install -g pnpm@12`), then the commands below in this folder with `pnpm` in place of `npm`.
<!-- /goodfellow-repository -->

```sh
npm install
npm run dev          # site at http://localhost:4321, admin panel at http://localhost:4321/admin
npm run build        # builds the site for its server
npm run migration -- add-jobs   # makes a migration, named by when it was made
npm run migrations   # writes migrations/sqlite/ and migrations/postgres/ after a change to lib/db/migrations/
npm test
```

On your own computer, the admin panel saves straight to the files in `content/`, with no sign-in. Copy `.env.example` to `.env.local` for what the server reads.

## Changing the database

Each migration is a file of its own in `lib/db/migrations/`, named by when it was made, such as `20261109033700_auth.ts`. Nothing lists them: they're found by their names. So when several people each add tables on their own branches, their changes never touch the same file, and none of them conflicts with another's. D1, and the Postgres migrator, apply each migration that hasn't run yet, whatever order the branches merge in.

1. `npm run migration -- add-jobs` makes `lib/db/migrations/<when>_add-jobs.ts`. Write its tables with Kysely's schema builder, using `typesFor()` for dates and yes-or-no columns, so the same file works for SQLite and Postgres.
2. `npm run migrations` writes its SQL into `migrations/sqlite/` and `migrations/postgres/`, which a test checks are up to date.
3. Never change a migration once it's merged: add another.

## Rendering

Every page is rendered once and served as it was, so a request costs the server almost nothing:

- **Pages that look the same to everyone**, which is every page here, are static.
- **What shows who's signed in** is filled in by the browser (`app/(site)/members/signed-in-as.tsx`), so the page around it stays static.
- **Pages only for people who are signed in**, such as `/members`, are static too: `proxy.ts` sends everyone else to sign in before the page is served.

## How it fits together

| File | What it does |
|---|---|
| `goodfellow.config.tsx` | The site's blocks, and the content repository its server publishes to |
| `lib/env.ts` | The one place the site reads its bindings and secrets, so nothing else knows where it runs |
| `lib/db/dialect.ts` | The one place that knows the database: Cloudflare D1 where it's bound as `DB`, or Postgres at `DATABASE_URL` |
| `lib/db/migrations/` | The database's tables, a migration a file, each written once with Kysely's schema builder; `npm run migrations` writes each database's SQL into `migrations/` |
| `lib/auth.ts` | Sign-in with [Better Auth](https://www.better-auth.com): email addresses and passwords, no sign-up, and two roles, `admin` (the site's owners) and `editor` |
| `app/api/auth/[...all]/route.ts` | Better Auth's routes |
| `app/api/goodfellow/[...path]/route.ts` | The admin panel's API, which publishes to the content repository with `GOODFELLOW_GIT_TOKEN` |
| `app/sign-in/`, `app/sign-out/` | Signing in and out |
| `app/(site)/members/` and `proxy.ts` | A page of the site's own, for people who are signed in |
| `app/(site)/[[...path]]/page.tsx` | Every page in `content/` |
| `app/admin/page.tsx` | The admin panel, which signs in with the site's own accounts |
