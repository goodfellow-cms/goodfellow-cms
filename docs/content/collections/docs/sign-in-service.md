---
version: 1
title: Sign-in service
description: How Sign in with GitHub works, what it keeps, its limits, and running your own copy.
section: developers
order: 9
---

**Sign in with GitHub** goes through a small service Goodfellow runs on Cloudflare Workers, since GitHub doesn't let a page sign people in by itself. Sites keep working without it: editors can always sign in with a token instead. GitLab needs no service, since GitLab lets pages sign people in themselves.

## How it works

The service gives the admin panel tokens from Goodfellow's GitHub App, which GitHub only gives for repositories the app is installed on. So the first time someone signs in to a site, an owner installs Goodfellow on it: the sign-in screen offers to, and GitHub's install page signs them in as it installs.

1. The sign-in screen checks with the service that Goodfellow is installed on the site's repository, and that the admin panel is at the address the site's settings (`content/site.json`) give.
2. **Sign in with GitHub** goes to GitHub, where the editor approves Goodfellow, and back to the admin panel.
3. The service checks the editor can publish to the repository, and gives the admin panel a token for that repository only, lasting an hour, along with a session. The admin panel asks for a new token with the session about once an hour, and each time the service checks with GitHub that the editor still edits the site.

## What it keeps

Nothing. GitHub gives the service the editor's own token when they sign in, which it uses only to check who they are and that they can edit the site, then revokes straight away. The session the browser keeps says only who the editor is and which site it's for, sealed with a key only the service has, so it can't be changed or made up. Removing someone as an editor on GitHub stops their session working within the hour.

The setup page is the one exception: creating a repository needs the person's own token, so the setup page's session keeps it, sealed, until the repository exists or half an hour has passed, whichever is first.

The tokens it gives are GitHub App installation tokens:

| Sign-in | GitHub App | What its tokens can do |
|---|---|---|
| Editors | Goodfellow (`goodfellow-cms`) | Read and change the site's files, and see its builds, deployments and GitHub Pages |
| Owners, on the Editors, Domain and Updates screens | Goodfellow owners (`goodfellow-cms-owner`) | Change who edits the site, its GitHub Pages settings and run its workflows |
| The setup page | Goodfellow owners | Create the repository, write its first files and workflows, and turn on GitHub Pages and protect its history |

Editors' tokens can't change workflows or the repository's settings. Commits made with them name the editor as their author, with GitHub's private email address for them, so they show on the editor's GitHub account.

## Where it works

The service gives tokens only to the address in the site's settings, and never to this computer (`localhost`), where `goodfellow dev` and `next dev` need no sign-in. When the address changes, as connecting a domain does, sign-in follows the site there once the new address is published. Copies of the admin panel elsewhere, such as a preview on Vercel, sign in with a token.

## Limits

The service runs on Cloudflare Workers' free plan, which allows 100,000 requests a day. An editor uses about one an hour, and a few more to sign in. When the day's requests have been used, Cloudflare stops answering until midnight UTC: the sign-in screen says signing in with GitHub isn't available, and editors sign in with a token until then.

The service keeps no counts of its own, since every request it gets counts towards that limit, even one it turns away. To stop any one computer using up the day's requests, Cloudflare's own rate limiting rules block it before it reaches the service. They need the service on a domain of its own on Cloudflare, since they can't apply to `workers.dev` addresses: under the domain's **Security → WAF → Rate limiting rules**, add a rule for the service's address that blocks an IP address making more than about 50 requests in 10 seconds. Signing in takes four or five.

## Running your own

A site can use its own copy of the service, with its own GitHub Apps. The service is `packages/worker` in Goodfellow's repository, and runs on Cloudflare's free plan.

1. **Deploy the service** with a Cloudflare account, to learn its address. In a copy of Goodfellow's repository, run `pnpm install`, then in `packages/worker`, run `pnpm run deploy`. Wrangler prints the address, such as `https://sign-in.your-name.workers.dev`. Until step 3, it answers but signs nobody in.
2. **Create two GitHub Apps** in your GitHub settings (**Developer settings → GitHub Apps → New GitHub App**), or your organization's. For both:
   - set the **Callback URL** to the service's address followed by `/github/callback`, such as `https://sign-in.your-name.workers.dev/github/callback`;
   - leave **Expire user authorization tokens** on, and turn on **Request user authorization (OAuth) during installation**, so installing signs people in too;
   - turn off **Webhook**;
   - under **Where can this GitHub App be installed?**, choose **Any account**, unless only your own sites will use it.

   Give them these repository permissions:
   - the everyday app: **Contents** read and write; **Actions**, **Deployments**, **Metadata** and **Pages** read-only;
   - the owners' app: **Administration**, **Actions**, **Contents**, **Pages** and **Workflows** read and write; **Metadata** read-only.

   For each, note its **App ID**, its **Client ID** and the last part of its address (its slug), generate a client secret, and generate a private key, which downloads a `.pem` file.
3. **Set up the service** for your apps. In `wrangler.jsonc`, put your apps' slugs, and your setup page's address if you have one. Set its secrets with `npx wrangler@4 secret put EDIT_APP_ID`, then `EDIT_CLIENT_ID`, `EDIT_CLIENT_SECRET` and `EDIT_PRIVATE_KEY` (the `.pem` file's contents), the same four for `OWNER_`, and `SESSION_KEY`, from `openssl rand -base64 32`. Then run `pnpm run deploy` again. Changing `SESSION_KEY` later signs everyone out.
4. **Use it** in each site's config: `github({ repo: "your-name/your-site", signIn: "https://sign-in.your-name.workers.dev" })`.
