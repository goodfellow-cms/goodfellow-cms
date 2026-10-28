---
version: 1
title: Sign-in service
description: How Sign in with GitHub works, what it keeps, its limits, and running it for your sites.
section: developers
order: 10
---

**Sign in with GitHub** goes through a small service on Cloudflare Workers, since GitHub doesn't let a page sign people in by itself. Goodfellow doesn't run one for everyone yet, and may in the future; until then, a site offers Sign in with GitHub only once its owner runs one, as [Running your own](#running-your-own) explains, and names it in the site's config. Sites work without it: editors sign in with a token instead. GitLab needs no service, since GitLab lets pages sign people in themselves.

## How it works

The service gives the admin panel tokens from its GitHub App, which GitHub only gives for repositories the app is installed on. So the first time someone signs in to a site, an owner installs the app on it: the sign-in screen offers to, and GitHub's install page signs them in as it installs.

1. The sign-in screen checks with the service that its app is installed on the site's repository, and that the admin panel is at the address the site's settings (`content/site.json`) give.
2. **Sign in with GitHub** goes to GitHub, where the editor approves the app, and back to the admin panel.
3. The service checks the editor can publish to the repository, and gives the admin panel a token for that repository only, lasting an hour, along with a session. The admin panel asks for a new token with the session about once an hour, and each time the service checks with GitHub that the editor still edits the site.

## What it keeps

Nothing. GitHub gives the service the editor's own token when they sign in, which it uses only to check who they are and that they can edit the site, then revokes straight away. The session the browser keeps says only who the editor is and which site it's for, sealed with a key only the service has, so it can't be changed or made up. Removing someone as an editor on GitHub stops their session working within the hour, and a session ends 12 hours after signing in (30 days with **Stay signed in**), however often it's used.

The setup page is the one exception: creating a repository needs the person's own token, so the setup page's session keeps it, sealed, until the repository exists (both of them, for a site whose content has a repository of its own) or half an hour has passed, whichever is first.

The tokens it gives are GitHub App installation tokens:

| Sign-in | GitHub App | What its tokens can do |
|---|---|---|
| Editors | The everyday app | Read and change the site's files, and see its builds, deployments and GitHub Pages, and what Cloudflare Pages says of its builds |
| Owners, on the Editors, Domain and Updates screens | The owners' app | Change who edits the site, its GitHub Pages settings and when it rebuilds overnight, and run its workflows |
| The setup page | The owners' app | Create the repository, write its first files and workflows, and turn on GitHub Pages and protect its history |

Editors' tokens can't change workflows or the repository's settings. Commits made with them name the editor as their author, with GitHub's private email address for them, so they show on the editor's GitHub account.

## Where it works

The service gives tokens only to the address in the site's settings, to the admin panel's [own address](/docs/custom-domains#an-admin-address) where the site's `goodfellow-site.json` names one, and to the site's other copies it names, such as a [staging site](/docs/staging), or, where it names a [token broker](/docs/token-broker), only to the broker, and never to this computer (`localhost`), where `goodfellow dev` and `next dev` need no sign-in. When the address changes, as connecting a domain does, sign-in follows the site there once the new address is published. Other copies of the admin panel, such as a preview on Vercel, sign in with a token.

Editors can change the files those addresses come from: `content/site.json`, and the config the site's build writes `goodfellow-site.json` from. GitHub signs in someone who has approved the app before without asking, so an owner's sign-in first shows a page of the service's own, naming the address the owner token would go to, and goes on to GitHub only from there. To rule out addresses the site's files could add, list the only ones the service may give tokens to in its `ALLOWED_ORIGINS` setting, which we recommend for every service (in `wrangler.jsonc`'s `vars`, separated by commas, such as `https://example.org,https://admin.example.org`): an address the site's files name then gets tokens only if it's listed there too, and owners' sign-ins to a listed address skip the page.

## Limits

The service runs on Cloudflare Workers' free plan, which allows 100,000 requests a day. An editor uses about one an hour, and a few more to sign in. When the day's requests have been used, Cloudflare stops answering until midnight UTC: the sign-in screen says signing in with GitHub isn't available, and editors sign in with a token until then.

The service keeps no counts of its own, since every request it gets counts towards that limit, even one it turns away. To stop any one computer using up the day's requests, Cloudflare's own rate limiting rules block it before it reaches the service. They need the service on a domain of its own on Cloudflare, since they can't apply to `workers.dev` addresses: under the domain's **Security → WAF → Rate limiting rules**, add a rule for the service's address that blocks an IP address making more than about 50 requests in 10 seconds. Signing in takes four or five.

## Running your own

A site's owner, or an organization for all its sites, can run the service, with GitHub Apps of its own. The service is `packages/worker` in Goodfellow's repository, and runs on Cloudflare's free plan. You need a Cloudflare account, a GitHub account and Node.js 22.23.4 or later, 24.22.1 or later, or 26.12.1 or later, which fix a security problem in earlier versions.

1. In a copy of Goodfellow's repository, run `pnpm install`.
2. In `packages/worker`, run `pnpm run setup`. It:
   - deploys the service to Cloudflare, to learn its address. Wrangler, Cloudflare's tool, asks you to sign in to Cloudflare, and the first time, to choose your `workers.dev` address;
   - asks whether an organization should own the GitHub Apps, and whether anyone's sites can use them;
   - opens a page in your browser that creates the two apps on GitHub with their settings filled in. For each, check its name, which editors see when they sign in, and choose **Create GitHub App**;
   - asks for your setup page's address, if you run one;
   - gives the service the apps' keys and a key for sealing sessions, deploys it again and checks it answers.

   Keep the changes it makes to `wrangler.jsonc`, so later deploys keep them.
3. **List your sites' addresses** in `wrangler.jsonc`'s `ALLOWED_ORIGINS`, separated by commas: each Site address, and each admin address and token broker's address. It's optional, but recommended: without it, the service gives tokens to the addresses the sites' own files name, which their editors can change (see [Where it works](#where-it-works)). Run `pnpm run deploy` again after changing it, and add a site's new address there before publishing it as the Site address.
4. **Use it** in each site's config: `github({ repo: "your-name/your-site", signIn: "https://sign-in.your-name.workers.dev" })`.

Run `pnpm run setup` again to change the setup page's address, or to replace the apps. It keeps the service's key for sealing sessions, since a new one would sign everyone out.

### Setting it up by hand

If the script can't run, the same steps by hand are:

1. **Deploy the service:** in `packages/worker`, run `pnpm run deploy`. Wrangler prints the address, such as `https://sign-in.your-name.workers.dev`. Until step 3, it answers but signs nobody in.
2. **Create two GitHub Apps** in your GitHub settings (**Developer settings → GitHub Apps → New GitHub App**), or your organization's. For both:
   - set the **Callback URL** to the service's address followed by `/github/callback`, such as `https://sign-in.your-name.workers.dev/github/callback`;
   - turn on **Request user authorization (OAuth) during installation**, so installing signs people in too;
   - turn off **Webhook**;
   - under **Where can this GitHub App be installed?**, choose **Any account**, unless only your own sites will use it.

   Give them these repository permissions:
   - the everyday app: **Contents** and **Pull requests** read and write; **Actions**, **Checks**, **Commit statuses**, **Deployments**, **Metadata** and **Pages** read-only. **Pull requests** lets editors [submit drafts for review](/docs/publishing#drafts) and ask the site's reviewers to look. **Checks** and **Commit statuses** show when [Cloudflare Pages](/docs/put-it-online#3-choose-a-host) has built the site. An app made before it asked for these still signs editors in, without them, until every installation has accepted them;
   - the owners' app: **Administration**, **Actions**, **Contents**, **Pages**, **Secrets**, **Variables** and **Workflows** read and write; **Metadata** read-only. The Updates screen uses **Variables** for when the site rebuilds overnight; an app made before it asked for Variables still signs owners in, and changing that setting asks for an owner token instead. The setup page uses **Secrets** to connect a site's code and content repositories, where its [content is kept in a repository of its own](/docs/content-repository); an app made before it asked for Secrets still creates sites, and the setup page explains what to add instead. Adding either to an existing app asks every installation to accept it.

   For each, note its **App ID**, its **Client ID** and the last part of its address (its slug), generate a client secret, and generate a private key, which downloads a `.pem` file.
3. **Set up the service** for your apps. In `wrangler.jsonc`, put your apps' slugs, your setup page's address if you have one, and, as we recommend, your sites' addresses in `ALLOWED_ORIGINS`. Set its secrets with `npx wrangler@4 secret put EDIT_APP_ID`, then `EDIT_CLIENT_ID`, `EDIT_CLIENT_SECRET` and `EDIT_PRIVATE_KEY` (the `.pem` file's contents), the same four for `OWNER_`, and `SESSION_KEY`, from `openssl rand -base64 32`. Then run `pnpm run deploy` again. Changing `SESSION_KEY` later signs everyone out.
