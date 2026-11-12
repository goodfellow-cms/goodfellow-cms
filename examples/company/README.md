# Company site

A full-stack website built with [Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) and [Next.js](https://nextjs.org), for an organization whose editors sign in with the site's own accounts rather than GitHub's. Pages are files in a content repository of their own, edited in the admin panel at `/admin`; the site's server publishes them for the editors and keeps accounts in a database.

It runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), built with [vinext](https://github.com/cloudflare/vinext), Cloudflare's build of Next.js, with a [D1](https://developers.cloudflare.com/d1/) database. It's being built in steps, and isn't released yet; the [full-stack Next.js](https://goodfellowcms.com/docs/full-stack-nextjs) docs page describes what it's built on.

## Working on the site

<!-- goodfellow-repository -->
> **In the Goodfellow repository**, this folder is part of a pnpm workspace, so `npm install` doesn't work here. From the repository's root, run `pnpm install` and `pnpm build` (get pnpm with `npm install -g pnpm@12`), then the commands below in this folder with `pnpm` in place of `npm`.
<!-- /goodfellow-repository -->

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in BETTER_AUTH_SECRET
npx wrangler d1 migrations apply goodfellow-company --local   # makes the database on this computer
npm run new-admin -- you@example.org "Your Name" --local       # an account to sign in with, on this computer
npm run dev          # site at http://localhost:4321, admin panel at http://localhost:4321/admin
npm run build        # builds the site into a Cloudflare Worker, in dist/
npm run preview      # runs that Worker at http://localhost:4321, as Cloudflare will
npm run migration -- add-jobs   # makes a migration, named by when it was made
npm run migrations   # writes migrations/sqlite/ and migrations/postgres/ after a change to lib/db/migrations/
npm run migrate      # applies migrations/postgres/ to the Postgres database at DATABASE_URL
npm test
```

On your own computer, the admin panel saves straight to the files in `content/`, with no sign-in. `npm run dev` runs Next.js, with the database wrangler keeps in `.wrangler/` and what `.dev.vars` says; to use Postgres instead, set `DATABASE_URL` in `.env.local` (see `.env.example`) and run `npm run migrate` with it set.

## Putting it online on Cloudflare

A publish shows the next time its pages are visited, without building the site (within about a minute at every Cloudflare location, as KV spreads it): a page renders from the content repository the first time it's visited after a publish, and a Workers KV namespace keeps it for every visit after, which costs one KV read. That first render reads every content file, which can take more than the free plan's 10 ms of CPU time on a large site, so plan on Workers Paid ($5 a month) unless your pages render within it. Pages already kept don't need GitHub to answer, but a page's first visit after a publish does.

1. **The content repository.** Make it as the [content repository](https://goodfellowcms.com/docs/content-repository) page says, with `content/` and `public/media/`, and name it in `goodfellow.config.tsx`'s `backend` and in `.github/workflows/deploy.yml`, in place of `your-name/your-site-content`.
2. **The database.** Sign in with `npx wrangler login`, run `npx wrangler d1 create goodfellow-company`, and put the `database_id` it gives in `wrangler.jsonc`. Then run `npx wrangler kv namespace create goodfellow-company-cache`, where rendered pages are kept, and put its `id` there too.
3. **The site's settings.** In `wrangler.jsonc`, set `GOODFELLOW_SITE_URL` to the site's address. Then set its secrets: `npx wrangler secret put BETTER_AUTH_SECRET` (at least 32 random characters, such as `openssl rand -base64 32` makes; without it, the site signs nobody in) and `npx wrangler secret put GOODFELLOW_GIT_TOKEN` (a fine-grained token that can publish to the content repository, and nothing else).
4. **Putting it online.** `npm run build && npm run deploy` applies the database's migrations and uploads the Worker. To do it from GitHub instead, after every change, add the secrets `.github/workflows/deploy.yml` lists to the code repository.
5. **The first admin.** Once the migrations are applied, `npm run new-admin -- you@example.org "Your Name" --remote` makes an admin, one of the site's owners, in the D1 database. It asks for their password, which it never shows or keeps, and runs only in a terminal of your own, never in CI. Run it again for each admin.

Pages show a publish without a build, but new photos and other files reach the site's own files only when it's built again, so the content repository still asks for a build after each publish. Until that build is online, which takes a few minutes, a page that shows a new photo shows it missing, so publish a photo a few minutes before the page that shows it, or wait for the build before sharing the page. Add this workflow to it as `.github/workflows/deploy-site.yml`, with a `GOODFELLOW_DEPLOY_TOKEN` secret: a fine-grained token for the code repository with only **Actions: Read and write**, which can start its workflows but never change its code.

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

Each migration is a file of its own in `lib/db/migrations/`, named by when it was made, such as `20261109033700_auth.ts`. Nothing lists them: they're found by their names. So when several people each add tables on their own branches, their changes never touch the same file, and none of them conflicts with another's. D1, and `npm run migrate` on Postgres, apply each migration that hasn't run yet, whatever order the branches merge in.

1. `npm run migration -- add-jobs` makes `lib/db/migrations/<when>_add-jobs.ts`. Write its tables with Kysely's schema builder, using `typesFor()` for dates and yes-or-no columns, so the same file works for SQLite and Postgres.
2. `npm run migrations` writes its SQL into `migrations/sqlite/` and `migrations/postgres/`, which a test checks are up to date.
3. Never change a migration once it's merged: add another.

## Running it somewhere else

Only `lib/env.ts`, `lib/db/dialect.ts`, and the files Cloudflare reads (`wrangler.jsonc`, `vite.config.ts`, and the deploy workflow) know the site runs on Cloudflare. Everything else runs wherever Next.js does, with any Postgres database, such as Neon's: build it with `goodfellow-next finish --server && next build`, set `DATABASE_URL` and the variables in `.env.example`, and run `npm run migrate` before each deploy. With `DATABASE_URL` set, `npm run new-admin -- you@example.org "Your Name"` makes an admin there.

## Signing in

Each address can try to sign in 10 times in 5 minutes (`SIGN_IN_LIMIT` in `lib/auth.ts`). Better Auth counts the tries in the database, so every copy of the Worker counts the same ones, by the visitor's address, which Cloudflare gives the Worker as `cf-connecting-ip`. Elsewhere, set `CLIENT_IP_HEADER` to the header your host sets to the visitor's address, never one visitors can send themselves; without it, Better Auth reads `x-forwarded-for`.

Signing out (`app/sign-out/`) works only from the site's own pages, so a link on another site can't sign people out; an address typed in asks first.

## Editors

Admins invite people from **Editors** (`/admin/editors/`): its name, email address, and whether they can edit pages or everything. The site makes their account with a password nobody knows and emails them a link to choose their own, which works once, for 48 hours (`INVITATION_HOURS` in `lib/editors.ts`). Until they've chosen one, the page lists them as invited and can send the link again, which makes the one before stop working. An account's links are sent and used one at a time, so exactly one works; someone who sends or uses one while another is being sent or used is asked to try again in a moment. Admins change what others can do and remove them there, but never themselves, so the site always keeps an admin.

Email goes through [Resend](https://resend.com) (`lib/email.ts`), since Workers can't send it any other way. Make a key that can only send, from a domain you've verified there, and set it as the `RESEND_API_KEY` secret, and add `EMAIL_FROM` (such as `Example Co <hello@example.org>`) to `wrangler.jsonc`'s `vars`. Without them, the editors page shows each invitation's link for you to send yourself.

**Forgot your password?** on the sign-in page emails a link to choose a new one, which works once, for 30 minutes, and signs the account out everywhere once it's used. It says the same whether or not the address has an account. Each computer's network address can ask 5 times an hour, and each account is sent at most 3 links an hour, however many computers ask, even after one is used (`RESET_LIMIT` and `RESET_ACCOUNT_LIMIT` in `lib/auth.ts`). An email the email service refuses (Resend answers 4xx) doesn't count, so a misconfiguration doesn't use them up; one that may have gone does, such as a request that timed out or met Resend's own error (5xx), which can still have sent it. So someone asking for another person's address over and over can hold up that person's own link for up to an hour, which is the price of not letting them fill the inbox. Using any link makes the account's other links stop working, even when two are used at the same moment, since only one is used at a time. That holds for 30 seconds a link (`LINK_LOCK_SECONDS`): if the server stalls for longer in the middle of saving a password, after the link was used, and the person sets another password with a newer link meanwhile, the stalled one can be saved last. Better Auth's password update can't be made to wait for the lock, and D1 has no transactions to hold them together, so this is accepted. Someone who hasn't joined yet gets no reset email, since their invitation is how they choose a password: an admin sends it again. Without email set up, the page says the site can't send the link. Passwords are at least 12 characters.

## Rendering

Every page is rendered once for each publish and served as it was, so a request costs the server almost nothing:

- **Pages that look the same to everyone**, which is every page here, render from the content repository as it is now (`repositorySource()` in `lib/site.ts`, with `GOODFELLOW_GIT_TOKEN`) the first time they're visited, and the `VINEXT_KV_CACHE` namespace keeps them (vinext's `kvDataAdapter()` in `vite.config.ts`; Workers Cache would need no namespace, but nothing emulates it outside Cloudflare, so the tests couldn't check it). Each publish asks for every page to render again (`revalidatePath()` in `app/api/goodfellow/[...path]/route.ts`), since a change to the header, menus, or a collection can reach any page. A page also renders again once it's an hour old (`revalidate`), so a scheduled time coming, what a page shows by today's date, and changes that reach the content repository another way, such as from Claude or a merged review, show within the hour. In `npm run dev`, pages read the files on this computer.
- **What shows who's signed in** is filled in by the browser (`app/(site)/members/signed-in-as.tsx`), so the page around it stays static.
- **Pages only for people who are signed in**, such as `/members`, are static too: `proxy.ts` checks the session in the database on every request, so a used reset link, a ban, or a removal takes effect at once, and sends everyone else to sign in before the page is served.

## How it fits together

| File | What it does |
|---|---|
| `goodfellow.config.tsx` | The site's blocks, and the content repository its server publishes to |
| `wrangler.jsonc` | The Cloudflare Worker: its name, its D1 database bound as `DB`, and its settings |
| `vite.config.ts` | How vinext builds the site into that Worker, keeping rendered pages in Workers KV |
| `.github/workflows/deploy.yml` | Builds the site with its content and puts it online, after every change |
| `lib/env.ts` | The one place the site reads its bindings and secrets, so nothing else knows where it runs: the Worker's on Cloudflare, wrangler's in `npm run dev` |
| `lib/db/dialect.ts` | The one place that knows the database: Cloudflare D1 where it's bound as `DB`, or Postgres at `DATABASE_URL`, through [node-postgres](https://node-postgres.com) |
| `lib/db/migrations/` | The database's tables, a migration a file, each written once with Kysely's schema builder; `npm run migrations` writes each database's SQL into `migrations/` |
| `lib/auth.ts` | Sign-in with [Better Auth](https://www.better-auth.com): email addresses and passwords, no sign-up, a limit on tries, and two roles, `admin` (the site's owners) and `editor` |
| `lib/db/new-admin.ts`, `scripts/new-admin.ts` | `npm run new-admin`, which makes an admin with Better Auth itself |
| `app/api/auth/[...all]/route.ts` | Better Auth's routes |
| `app/api/goodfellow/[...path]/route.ts` | The admin panel's API, which publishes to the content repository with `GOODFELLOW_GIT_TOKEN` |
| `app/sign-in/`, `app/sign-out/`, `lib/sign-out.ts` | Signing in and out |
| `app/(site)/members/` and `proxy.ts` | A page of the site's own, for people who are signed in |
| `app/(site)/[[...path]]/page.tsx` | Every page in `content/` |
| `app/admin/page.tsx` | The admin panel, which signs in with the site's own accounts |
