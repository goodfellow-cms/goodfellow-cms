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
4. **Payments**, if the site sells subscriptions: set up Stripe as [Payments](#payments) says, all but putting the price in the Buy button, which a site owner does once they can sign in (step 7). The site works without Stripe, and admins can still give subscriptions by hand.
5. **Email.** Choose a service for invitations and password resets, and give the code repository its settings, as [Email](#email) says. The site works without it: the editors page then shows each invitation's link for you to send yourself.
6. **Putting it online.** Add the secrets `.github/workflows/deploy.yml` lists to the code repository and run its **Deploy** workflow (Actions → Deploy → Run workflow), which runs again after every change to the code. From your own computer, `npm run build && npm run deploy` does the same, except that it doesn't change the Worker's email settings.
7. **The first admin.** Once the migrations are applied, `npm run new-admin -- you@example.org "Your Name" --remote` makes an admin, one of the site's owners, in the D1 database. It asks for their password, which it never shows or keeps, and runs only in a terminal of your own, never in CI. Run it again for each admin. Each admin then signs in and turns on two-factor sign-in at `/account/` straight away, without which they can edit pages but not change Site Settings or manage editors, and before which anyone with their password could turn it on with an app of their own.

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

Admins invite people from **Editors** (`/admin/editors/`): its name, email address, and whether they can edit pages or everything. The site makes their account with a password nobody knows and emails them a link to choose their own, which works once, for 48 hours (`INVITATION_HOURS` in `lib/editors.ts`). Until they've chosen one, the page lists them as invited and can send the link again, which makes the one before stop working. An account's links are sent and used one at a time, so exactly one works; someone who sends or uses one while another is being sent or used is asked to try again in a moment. Admins change what others can do and remove them there, but never themselves, so the site always keeps an admin. Readers who signed up aren't listed there, however many there are: they're on the subscribers page (see [Subscribers](#subscribers)).

Invitations and password resets are sent by email: see [Email](#email). Without it, the editors page shows each invitation's link for you to send yourself.

**Two-factor sign-in** (`/account/`) asks for a code from an authenticator app after the password, through Better Auth's two-factor plugin. Admins need it to act as admins: with only a password, they edit pages as editors do, so someone who learns the password of an admin who has turned it on can't change the site's settings or its editors. Until an admin turns it on, whoever has their password could turn it on with an app of their own, so admins turn it on as soon as they first sign in. Turning it on asks for the password again and shows a QR code, the key to type in instead, and ten backup codes, each of which signs in once; once the code is checked, every other session the account had is signed out, so one that signed in with the password alone, perhaps someone else's, never becomes an admin's. Each address can try 10 codes in 5 minutes (`TWO_FACTOR_LIMIT`), Better Auth locks an account's codes for a while after ten wrong ones (so someone who has an admin's password but not their phone can keep that admin's codes locked; choosing a new password with **Forgot your password?** stops them, since only the password reaches the code step), and keeps the secrets and backup codes encrypted with `BETTER_AUTH_SECRET`. The admin plugin's own routes (`/api/auth/admin/…`) are closed (`authRoute()` in `lib/auth.ts`), so admins manage people only through the editors page, where these rules hold.

Changing `BETTER_AUTH_SECRET` signs everyone out and leaves the codes of everyone who turned two-factor sign-in on unreadable, so they can't get past the code step, and turning it on again needs a signed-in session. Turn it off for every account, then ask each admin to sign in with their password and turn it on again at once: until they do, they're editors, and anyone who learns their password could turn it on with an app of their own.

```sh
npx wrangler d1 execute goodfellow-company --remote --command "update user set twoFactorEnabled = 0; delete from twoFactor;"
```

**Forgot your password?** on the sign-in page emails a link to choose a new one, which works once, for 30 minutes, and signs the account out everywhere once it's used. It says the same whether or not the address has an account. Each computer's network address can ask 5 times an hour, and each account is sent at most 3 links an hour, however many computers ask, even after one is used (`RESET_LIMIT` and `RESET_ACCOUNT_LIMIT` in `lib/auth.ts`). An email the email service refuses (it answers 4xx every time it's tried) doesn't count, so a misconfiguration doesn't use them up; one that may have gone does, such as a request that timed out or met the service's own error (5xx), which can still have sent it. So someone asking for another person's address over and over can hold up that person's own link for up to an hour, which is the price of not letting them fill the inbox. Using any link makes the account's other links stop working, even when two are used at the same moment, since only one is used at a time. That holds for 30 seconds a link (`LINK_LOCK_SECONDS`): if the server stalls for longer in the middle of saving a password, after the link was used, and the person sets another password with a newer link meanwhile, the stalled one can be saved last. Better Auth's password update can't be made to wait for the lock, and D1 has no transactions to hold them together, so this is accepted. Someone who hasn't joined yet gets no reset email, since their invitation is how they choose a password: an admin sends it again. Without email set up, the page says the site can't send the link. Passwords are at least 12 characters.

## Email

The site sends email through the service its settings name, with [Upyo](https://upyo.org) (`lib/email.ts`), which speaks to each one's HTTP API, since Workers can't send email any other way. Nothing in the code names a service, so the site's owners can move to another one without a developer, from the code repository's settings on GitHub.

**Not sure which to use?** If the company doesn't already have an email service, use [Resend](https://resend.com). It's the simplest to set up: you verify your domain by adding the DNS records it shows you, and make a key that can only send. Its [free plan](https://resend.com/pricing) sends 3,000 emails a month, at most 100 a day, which is far more than invitations and password resets need. Its link tracking is off unless someone turns it on. If the company already sends email through Mailgun, SendGrid, Amazon SES, or Plunk, use that instead, so its domain's settings stay in one place.

Changing the settings takes the repository's **Admin** role, so give it to the owners who look after the site:

1. **Make a key at the service** that can only send, from a domain you've verified there, so a key that leaks can't do more.
2. **Change the settings**, in the code repository's **Settings → Secrets and variables → Actions**. On the **Variables** tab, set `EMAIL_PROVIDER` to the service, `EMAIL_FROM` to who the emails are from (such as `Example Co <hello@example.org>`, on the domain you verified), and any of the others the service needs, from the table below; delete any the new service doesn't use. On the **Secrets** tab, set `EMAIL_API_KEY` to the key.
3. **Run the Deploy workflow** (**Actions → Deploy → Run workflow**). It gives the Worker the new settings, and the site sends with them from then on.

| `EMAIL_PROVIDER` | `EMAIL_API_KEY` | Also set |
|---|---|---|
| `resend` | An API key with **Sending access** | |
| `mailgun` | A sending key | `EMAIL_DOMAIN`, where Mailgun's domain isn't `EMAIL_FROM`'s; `EMAIL_REGION` `eu` for its European region |
| `sendgrid` | An API key with **Mail Send** only | |
| `ses` | An IAM user's secret access key, allowed only `ses:SendEmail` | `EMAIL_KEY_ID`, its access key id; `EMAIL_REGION`, such as `us-east-1` |
| `plunk` | A secret API key | |

Running Deploy is safe at any time: it builds the site from the code repository as it is. Changing a setting takes this one run, and nothing else; a variable you delete is taken from the Worker too. The key isn't: without the `EMAIL_API_KEY` secret, Deploy leaves the Worker the key it has, since some sites set it with `wrangler` instead. To retire a key, such as one that may have leaked, revoke it at the email service, then remove it from the Worker with `npx wrangler secret delete EMAIL_API_KEY`, or set the secret to the new key and run Deploy. Link tracking must stay off, since it would send every link in a message, each of which lets someone into an account, through the service's servers first. Mailgun's and SendGrid's are turned off with each message. The others are set at the service, so check them there: in Resend, keep click and open tracking off in the sending domain's settings; in Plunk, keep tracking disabled in the project's settings; in SES, make sure neither the sending identity nor the account has a default configuration set that tracks clicks or opens. If a message can't be sent, the editors page says so, and the server's log names only the kind of failure.

To use a service Upyo supports that isn't in the table, add it to `transportFor()` in `lib/email.ts`, with its package. In `npm run dev`, put the same settings in `.dev.vars`.

## Subscribers

A page whose settings say **Only signed-in members**, such as `/handbook` here, is for subscribers. Everyone else sees its teaser: the blocks above its **Paywall** block, which editors put where the teaser should end, and the Paywall, which links to sign in and, once there's a **Where people subscribe** address, to subscribe. Subscribers see the whole page, without the Paywall. A page for members with no Paywall shows everyone else only the Paywall, so nothing an editor didn't choose to show is published. It's left out of the site's search, feeds, and content API either way.

Who subscribes is in the database's `entitlement` table (`lib/entitlements.ts`, the only file that reads it): a `subscription`, which runs until its `expiresAt`, or never where that's empty, or a `purchase`, kept for good. Payments write it, through Stripe (see [Payments](#payments)), and admins can give one by hand.

**Signing up** (`/sign-up/`, linked from the sign-in page, which the Paywall links to, `lib/sign-up.ts`) asks only for a name and an email address. It makes a reader's account, with the `member` role (`MEMBER_ROLE` in `lib/roles.ts`), so it can't edit anything and the admin panel turns it away, and, as an invitation does, a password nobody knows: the site emails a link to choose one, which confirms the address is theirs, and goes on to signing in at the page they came from. The link works for 24 hours (`VERIFY_HOURS`), and nobody signs in with the address until a password has been chosen from it, so someone who signs up with another person's address gets nothing; if its owner never chose a password, signing up again sends them a new link, and an admin can still invite the address as an editor, which takes the account over. Signing up with an address that already has a password, or is an editor's, answers as for a new one and sends nothing, so nobody learns who has an account here; the page says to sign in or choose a new password instead. Each network address can sign up 5 times an hour (`SIGN_UP_LIMIT`, by `CLIENT_IP_HEADER`, so in `npm run dev`, which has none, every sign-up counts as one address's), and each account is sent at most 3 of these emails an hour, however many computers ask, as with password resets (`VERIFY_ACCOUNT_LIMIT`). Without email set up, nobody can sign up, since nobody could choose a password.

Admins see readers on **Subscribers** (`/admin/subscribers/`), with who subscribes, until when (to the end of the day chosen, UTC), and whether they paid or were given it, and can give anyone with an account a subscription by hand, with an end date or none, take back one they gave, and remove a reader's account. A subscription someone paid for is changed or ended in Stripe. A reader has one subscription given by hand at most, which a new one changes in place, so a gift that fails to save leaves the one before as it was. The database holds no second (a unique index), so when two admins give one at once, whichever the database writes last stays. Taking one back, or removing a reader, as when a subscription ends, shows members' pages for up to 10 more minutes (`PAYWALL_SECONDS` in `lib/paywall-time.ts`, see below). A reader can't also be an editor: an admin invites editors with an address of their own.

Every page has a version for everyone and one for subscribers, and each is kept once it has rendered, as every page is (see [Rendering](#rendering)), so a request reads no database to choose between them. Every page has a subscribers' version, not only those for members, since `proxy.ts` can't tell which those are; for pages for everyone it's the same page. `proxy.ts` sends a subscriber's request for a page to its members' version, in `app/(site)/members/pages/`, by a cookie `lib/paywall.ts` signs with `BETTER_AUTH_SECRET`, which says whether the person subscribes. It belongs to the session it was made for, so it stops counting once they sign out, and it lasts 10 minutes (`PAYWALL_SECONDS`), or until the subscription ends if that's sooner: someone whose subscription is cancelled can still read members' pages for up to 10 minutes, and someone who has just subscribed waits as long on a page they'd already opened. Only then is the database asked again. A request for an address under `/members/pages/` itself is "Page not found", however it's spelled, so the cookie is the only way in, and members' versions are sent with `Cache-Control: private`, so no cache between the site and the browser keeps one for anyone else.

## Payments

Readers pay with [Stripe Checkout](https://docs.stripe.com/payments/checkout), on Stripe's own page, so the site never sees a card (`lib/stripe.ts`). A **Buy button** block sells one Stripe price: the Subscribe page (`/subscribe`) has one, which the handbook's Paywall links to. Its price is an owners-only setting, so editors can move and reword the button but never choose what it sells, or for how much, and the server reads the price from the page as it's published, never from the browser. A button without a price isn't shown on the site; the editor says a site owner needs to choose one. A price that repeats sells a subscription, and any other sells something bought once, kept for good.

Someone not signed in is asked to sign in or sign up first, and comes back to the page. After paying, Stripe sends them back, and the site records what they bought as soon as they return, then again from Stripe's events, which are what keep it up to date: a renewal moves the subscription's end to the end of the period paid for, and once Stripe ends a subscription, for a cancellation or payments that failed for good, it ends here too, showing members' pages for up to 10 more minutes (see [Subscribers](#subscribers)). While Stripe retries a renewal's payment, or leaves it unpaid, the subscription gives nothing, since Stripe has already moved it on to the period not paid for, until the payment goes through. Something Stripe no longer has, as once its customer or test data is deleted there, gives nothing either. One rare case is left open: if writing a subscription stalls for over a minute, a cancellation is written meanwhile, and the server is then stopped before the stalled write can be taken back, the subscription stays until the end of the period it had paid for. A refund, even of part of it, or a dispute takes away what that payment bought, and only that: something bought twice stays until both payments are taken back, and coming back from Checkout with a refunded payment gives nothing back. A refund that fails, or a dispute the site wins, gives it back. A subscription's refund or dispute doesn't end it, so cancel it in Stripe too. Everything someone buys is paid as one Stripe customer, made with their address the first time they go to Checkout, which the site keeps (`stripeCustomerId`), so their account page opens Stripe's customer portal, where they manage what they pay and stop, even once a subscription has stopped giving them anything, as when its payments failed. Someone who already has a subscription that hasn't ended, even one whose first payment is still on its way or one that's paused, and presses a Buy button for it again, at any of its product's prices, goes to the portal rather than paying twice, and someone who has started paying for it and presses again goes back to the same Checkout, for the same price; one open for another of its prices, as when they press the yearly button after the monthly, or its owners have changed the button's price since, is closed, so they pay only the price they chose now. Where Stripe no longer has the customer the site kept (deleted there, or the site moved from test mode to live), their next Checkout makes a new one. Nothing is written for an account that has been deleted since.

To set it up, in [Stripe's dashboard](https://dashboard.stripe.com), in test mode first:

1. **What to sell.** Make a product with a price (**Product catalog → Add product**), monthly for a subscription, and copy the price's id, `price_…`. Once the first admin exists (step 7 of [Putting it online on Cloudflare](#putting-it-online-on-cloudflare)), a site owner signs in to the admin panel, opens the Subscribe page, and puts it in the Buy button's **Stripe price**.
2. **A restricted key** (**Developers → API keys → Create restricted key**) with only what the site uses: **Prices: Read**, **Checkout Sessions: Write**, **Subscriptions: Read**, **Customers: Write**, **Payment Intents: Read**, **Charges: Read** and **Disputes: Read** (to see whether a payment was refunded or disputed, and how a dispute ended), and **Customer portal: Write**. Set it with `npx wrangler secret put STRIPE_SECRET_KEY`. Without it, Buy buttons say the site doesn't take payments yet.
3. **The webhook** (**Developers → Webhooks → Add destination**), to `https://your-site.example/api/stripe/webhook/`, with the trailing slash, since Stripe doesn't follow redirects, for these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `charge.refunded`, `charge.refund.updated`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, and `charge.dispute.closed`. Set its signing secret, `whsec_…`, with `npx wrangler secret put STRIPE_WEBHOOK_SECRET`. The site acts on each event once, and only on ones Stripe signed; one it was still handling when its request stopped is done again when Stripe retries, once 5 minutes have passed. It writes one subscription or payment at a time, so an event that arrives while another is writing the same one is answered 409, and Stripe sends it again shortly after.
4. **The customer portal** (**Settings → Billing → Customer portal**): choose what subscribers may do, such as cancel and change how they pay, and save it, since Stripe opens it only once it's saved.

Try it with Stripe's test cards, then do the same in live mode, with the live key, webhook secret, and price. In `npm run dev`, put the test key and the secret `stripe listen --forward-to localhost:4321/api/stripe/webhook/` prints in `.dev.vars`.

## Rendering

Every page is rendered once for each publish and served as it was, so a request costs the server almost nothing:

- **Pages that look the same to everyone**, which is every page here, render from the content repository as it is now (`repositorySource()` in `lib/site.ts`, with `GOODFELLOW_GIT_TOKEN`) the first time they're visited, and the `VINEXT_KV_CACHE` namespace keeps them (vinext's `kvDataAdapter()` in `vite.config.ts`; Workers Cache would need no namespace, but nothing emulates it outside Cloudflare, so the tests couldn't check it). Each publish asks for every page to render again (`revalidatePath()` in `app/api/goodfellow/[...path]/route.ts`), since a change to the header, menus, or a collection can reach any page. A page also renders again once it's an hour old (`revalidate`), so a scheduled time coming, what a page shows by today's date, and changes that reach the content repository another way, such as from Claude or a merged review, show within the hour. In `npm run dev`, pages read the files on this computer.
- **Members-only pages render twice**, the same way: for everyone, where they're teasers, and for subscribers, which `proxy.ts` chooses between by a signed cookie (see [Subscribers](#subscribers)).
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
| `lib/auth.ts` | Sign-in with [Better Auth](https://www.better-auth.com): email addresses and passwords, a limit on tries, and three roles, `admin` (the site's owners), `editor`, and `member` (readers, `lib/roles.ts`) |
| `lib/entitlements.ts` | What each person is entitled to, such as a subscription: the one file that reads the `entitlement` table |
| `lib/stripe.ts`, `blocks/buy-button.tsx`, `app/api/checkout/`, `app/api/stripe/webhook/`, `app/api/billing/` | Payments: the Buy button, Stripe Checkout and its webhook, and the customer portal |
| `lib/paywall.ts`, `blocks/paywall.tsx` | Which version of a page each request gets, by a signed cookie, and the Paywall block, where a page for members stops for everyone else |
| `lib/db/new-admin.ts`, `scripts/new-admin.ts` | `npm run new-admin`, which makes an admin with Better Auth itself |
| `app/api/auth/[...all]/route.ts` | Better Auth's routes |
| `app/api/goodfellow/[...path]/route.ts` | The admin panel's API, which publishes to the content repository with `GOODFELLOW_GIT_TOKEN` |
| `app/sign-in/`, `app/sign-up/`, `app/sign-out/`, `lib/sign-up.ts`, `lib/sign-out.ts` | Signing in, up, and out |
| `app/admin/subscribers/`, `lib/subscribers.ts` | The subscribers page: readers, their subscriptions, and giving one by hand |
| `app/(site)/members/` and `proxy.ts` | A page of the site's own, for people who are signed in, and the members' versions of pages (`members/pages/`), which only `proxy.ts` sends requests to |
| `app/(site)/[[...path]]/page.tsx` | Every page in `content/` |
| `app/admin/page.tsx` | The admin panel, which signs in with the site's own accounts |
