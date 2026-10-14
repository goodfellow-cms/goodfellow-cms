---
version: 1
title: Sign-in service
description: How Sign in with GitHub works, what it keeps, its limits, and running your own copy.
section: developers
order: 9
---

**Sign in with GitHub** goes through a small service Goodfellow runs on Cloudflare Workers, since GitHub doesn't let a page sign people in by itself. Sites keep working without it: editors can always sign in with a token instead. GitLab needs no service, since GitLab lets pages sign people in themselves.

## How it works

1. The sign-in screen checks with the service that Goodfellow is installed on the site's repository, and that the admin panel is at the address the site's settings (`content/site.json`) give.
2. **Sign in with GitHub** goes to GitHub, where the editor approves Goodfellow, and back to the admin panel.
3. The service checks the editor can publish to the repository, and gives the admin panel a token for that repository only, lasting an hour, along with a session that only the service can read. The admin panel asks for a new token with the session while the editor is signed in.

What the service keeps, it keeps in the session, sealed with a key only the service has: the editor's own GitHub token, which never reaches the browser. It stores nothing else, apart from how many times it's been used each day.

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

To stay within Cloudflare's free plan, the service counts requests each day, in UTC: 300 for each editor, 3,000 for each site and 40,000 overall. An editor uses about one an hour. When a limit is reached, the sign-in screen says so, and editors sign in with a token until the next day.

## Running your own

A site can use its own copy of the service, with its own GitHub Apps. The service is `packages/worker` in Goodfellow's repository.

1. **Create two GitHub Apps** in your GitHub settings (**Developer settings → GitHub Apps → New GitHub App**), or your organization's. For both, set the **Callback URL** to your service's address followed by `/github/callback`, such as `https://sign-in.your-name.workers.dev/github/callback`; leave **Expire user authorization tokens** on and **Request user authorization (OAuth) during installation** off; and turn off **Webhook**. Give them these repository permissions:
   - the everyday app: **Contents** read and write; **Actions**, **Deployments**, **Metadata** and **Pages** read-only;
   - the owners' app: **Administration**, **Actions**, **Contents**, **Pages** and **Workflows** read and write; **Metadata** read-only.

   For each, note its **App ID**, its **Client ID** and its URL's last part (its slug), generate a client secret, and generate a private key, which downloads a `.pem` file.
2. **Deploy the service** with a Cloudflare account. In a copy of Goodfellow's repository, run `pnpm install`, then in `packages/worker`, put your apps' slugs and your setup page's address, if you have one, in `wrangler.jsonc`, and set its secrets: `npx wrangler@4 secret put EDIT_APP_ID`, then `EDIT_CLIENT_ID`, `EDIT_CLIENT_SECRET`, `EDIT_PRIVATE_KEY` (the `.pem` file's contents), the same four for `OWNER_`, and `SESSION_KEY`, from `openssl rand -base64 32`. Then run `pnpm run deploy`. Changing `SESSION_KEY` signs everyone out.
3. **Use it** in each site's config: `github({ repo: "your-name/your-site", signIn: "https://sign-in.your-name.workers.dev" })`, then install both apps on the site's repository.

The daily limits can be changed with the `LIMIT_EDITOR`, `LIMIT_SITE` and `LIMIT_ALL` variables.
