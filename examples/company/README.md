# Company site

A full-stack website built with [Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) and [Next.js](https://nextjs.org), for an organization whose editors sign in with the site's own accounts rather than GitHub's. Pages are files in a content repository of their own, edited in the admin panel at `/admin`; the site's server publishes them for the editors and keeps accounts in a database.

It runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), built with [vinext](https://github.com/cloudflare/vinext), Cloudflare's build of Next.js, with a [D1](https://developers.cloudflare.com/d1/) database. It's being built in steps, and isn't released yet; the [full-stack Next.js](https://goodfellow-cms.github.io/goodfellow-cms/docs/full-stack-nextjs) docs page describes what it's built on.

## Working on the site

<!-- goodfellow-repository -->
> **In the Goodfellow repository**, this folder is part of a pnpm workspace, so `npm install` doesn't work here. From the repository's root, run `pnpm install` and `pnpm build` (get pnpm with `npm install -g pnpm@12`), then the commands below in this folder with `pnpm` in place of `npm`.
<!-- /goodfellow-repository -->

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in BETTER_AUTH_SECRET
npx wrangler d1 migrations apply goodfellow-company --local   # makes the database on this computer
npm run dev          # site at http://localhost:4321, admin panel at http://localhost:4321/admin
npm run build        # builds the site into a Cloudflare Worker, in dist/
npm run preview      # runs that Worker at http://localhost:4321, as Cloudflare will
npm run migration -- add-jobs   # makes a migration, named by when it was made
npm run migrations   # writes migrations/sqlite/ and migrations/postgres/ after a change to lib/db/migrations/
npm test
```

On your own computer, the admin panel saves straight to the files in `content/`, with no sign-in. `npm run dev` runs Next.js, with the database wrangler keeps in `.wrangler/` and what `.dev.vars` says; to use Postgres instead, set `DATABASE_URL` in `.env.local` (see `.env.example`).

## Putting it online on Cloudflare

It runs on Cloudflare's free plan. Every page is rendered while the site builds, so most visits cost almost nothing.

1. **The content repository.** Make it as the [content repository](https://goodfellow-cms.github.io/goodfellow-cms/docs/content-repository) page says, with `content/` and `public/media/`, and name it in `goodfellow.config.tsx`'s `backend` and in `.github/workflows/deploy.yml`, in place of `your-name/your-site-content`.
2. **The database.** Sign in with `npx wrangler login`, run `npx wrangler d1 create goodfellow-company`, and put the `database_id` it gives in `wrangler.jsonc`.
3. **The site's settings.** In `wrangler.jsonc`, set `GOODFELLOW_SITE_URL` to the site's address. Then set its secrets: `npx wrangler secret put BETTER_AUTH_SECRET` (at least 32 random characters, such as `openssl rand -base64 32` makes) and `npx wrangler secret put GOODFELLOW_GIT_TOKEN` (a fine-grained token that can publish to the content repository, and nothing else).
4. **Putting it online.** `npm run build && npm run deploy` applies the database's migrations and uploads the Worker. To do it from GitHub instead, after every change, add the secrets `.github/workflows/deploy.yml` lists to the code repository.

Publishing in the admin panel changes the content repository, so it's what has to ask for the site to be built again. Add this workflow to it as `.github/workflows/deploy-site.yml`, with a `GOODFELLOW_DEPLOY_TOKEN` secret: a fine-grained token for the code repository with only **Actions: Read and write**, which can start its workflows but never change its code.

```yaml
name: Put the site online
on:
  push:
    branches: [main]
permissions: {}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: gh workflow run deploy.yml --repo your-name/your-site
        env:
          GH_TOKEN: ${{ secrets.GOODFELLOW_DEPLOY_TOKEN }}
```

Add the site's domain to the Worker in Cloudflare's dashboard (Workers & Pages → goodfellow-company → Settings → Domains & Routes). Photos are resized with Cloudflare Images, whose free allowance is 5,000 different sizes a month; to turn it off, remove `images` from `vite.config.ts` and `wrangler.jsonc`.

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
| `wrangler.jsonc` | The Cloudflare Worker: its name, its D1 database bound as `DB`, and its settings |
| `vite.config.ts` | How vinext builds the site into that Worker, rendering every page as it builds |
| `.github/workflows/deploy.yml` | Builds the site with its content and puts it online, after every change |
| `lib/env.ts` | The one place the site reads its bindings and secrets, so nothing else knows where it runs: the Worker's on Cloudflare, wrangler's in `npm run dev` |
| `lib/db/dialect.ts` | The one place that knows the database: Cloudflare D1 where it's bound as `DB`, or Postgres at `DATABASE_URL` |
| `lib/db/migrations/` | The database's tables, a migration a file, each written once with Kysely's schema builder; `npm run migrations` writes each database's SQL into `migrations/` |
| `lib/auth.ts` | Sign-in with [Better Auth](https://www.better-auth.com): email addresses and passwords, no sign-up, and two roles, `admin` (the site's owners) and `editor` |
| `app/api/auth/[...all]/route.ts` | Better Auth's routes |
| `app/api/goodfellow/[...path]/route.ts` | The admin panel's API, which publishes to the content repository with `GOODFELLOW_GIT_TOKEN` |
| `app/sign-in/`, `app/sign-out/` | Signing in and out |
| `app/(site)/members/` and `proxy.ts` | A page of the site's own, for people who are signed in |
| `app/(site)/[[...path]]/page.tsx` | Every page in `content/` |
| `app/admin/page.tsx` | The admin panel, which signs in with the site's own accounts |
