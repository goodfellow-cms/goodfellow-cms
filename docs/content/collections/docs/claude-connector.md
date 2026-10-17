---
version: 1
title: Claude connector service
description: How the Claude connector works, what it keeps, its limits, and running it for your organization.
section: developers
order: 11
---

The Claude connector is an [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers, which editors add to Claude as a custom connector (see [Work with Claude](/docs/claude)). Goodfellow doesn't run one for everyone yet, and may in the future; an organization can run its own, as below. Like the [sign-in service](/docs/sign-in-service), it's the only server code Goodfellow has, and sites don't need it: Claude can run the same tools on an editor's computer with a token.

## How it works

The connector is two things at one address: the MCP server, at `/mcp`, and the OAuth server Claude signs in with.

1. Claude's first request to `/mcp` is answered with where to sign in. Claude registers itself, or names itself with a client ID metadata document, and opens `/authorize`.
2. The editor signs in with GitHub or GitLab and chooses the sites Claude may work on.
3. Claude gets an access token, lasting an hour, and a refresh token, which works once, and renews them as it needs.
4. With each request to `/mcp`, the connector signs in to the site's repository and runs Goodfellow's tools (`@goodfellow-cms/mcp`), the same ones that run on an editor's computer.

The tools read the site's files from its repository, and what blocks the site has from `goodfellow-site.json`, which every build publishes beside the site's pages: each block's settings, the content versions the site reads and its Goodfellow version. Changes go into a draft, a branch named `goodfellow-draft-…`, which publishing applies to the main branch in one commit, as the admin panel's **Publish** does, and submitting for review opens a pull request or merge request from. Screenshots of drafts open the site's preview page (`/admin/#/preview`), which is handed the draft's files and renders them as the admin panel's previews do.

## What it keeps

Who connected and which sites they chose are sealed inside the tokens Claude holds, with AES-GCM under a key only the connector has, so Claude can't read or change them. The one thing stored, in Cloudflare's D1 database, is each connection's refresh token generation and when it lapses, so a refresh token used twice ends the connection, as OAuth asks.

| Host | What the connector signs in with |
|---|---|
| GitHub | A GitHub App of its own, **Goodfellow for Claude** unless you name it otherwise, separate from the sign-in service's apps. The editor's own GitHub token shows which repositories they can publish to that the app is installed on, then it's revoked. Each request to `/mcp` gets an installation token for one repository, with Contents and Pull requests write, checks the editor still can publish to it, and revokes it once the request is answered. Commits name the editor as their author. |
| GitLab | A GitLab OAuth application with the `api` scope, since GitLab has no tokens for one project. The editor's GitLab tokens are sealed in Claude's: the access token in Claude's access token, which never outlasts it, and the refresh token in Claude's refresh token. Renewing Claude's tokens renews GitLab's. |

## Limits

The connector runs on Cloudflare Workers' free plan:

- **Requests:** 100,000 a day, for every editor together. A tool call is one request, and Claude makes a few more to start. When the day's are used, Cloudflare stops answering until midnight UTC and Claude says the connector isn't available. As with the sign-in service, the connector keeps no counts of its own; [Cloudflare's rate limiting rules](/docs/sign-in-service#limits) can stop one computer using them up.
- **Work per request:** 10 milliseconds of the processor's time and 50 requests to GitHub, GitLab or the site. So the tools read only the files they need, in batches through GitHub's and GitLab's GraphQL APIs, rather than loading the whole site.
- **Screenshots:** Cloudflare's Browser Rendering gives the free plan 10 minutes of browser time a day, with up to three browsers at once. A screenshot takes a few seconds.

## Running your own

An organization can run it, with its own GitHub App. The connector is `packages/connector` in Goodfellow's repository, and runs on Cloudflare's free plan. You need a Cloudflare account, a GitHub account and Node 22 or later.

1. In a copy of Goodfellow's repository, run `pnpm install`.
2. In `packages/connector`, run `pnpm run setup`. It:
   - creates the connector's database on Cloudflare, `goodfellow-connector`. Wrangler, Cloudflare's tool, asks you to sign in to Cloudflare, and the first time, to choose your `workers.dev` address;
   - deploys the connector, to learn its address;
   - asks whether an organization should own the GitHub App, and whether anyone's sites can use it;
   - opens a page in your browser that creates the app on GitHub with its settings filled in. Check its name, which editors see when they connect Claude, and choose **Create GitHub App**;
   - asks whether to work on sites on GitLab.com too. If so, add an application in GitLab (**Edit profile → Applications**) with the redirect URI it gives, **Confidential** on and the `api` scope, and give it the application's ID and secret, which isn't shown as you type;
   - gives the connector its secrets and a key for sealing tokens, deploys it again and checks it answers.

   Keep the change it makes to `wrangler.jsonc`, which names the database.
3. **Use it:** editors add `https://claude.your-name.workers.dev/mcp` (your connector's address) to Claude.

Run `pnpm run setup` again to replace the app or add GitLab. It keeps the connector's key for sealing tokens, since a new one would end every connection. For a GitLab of your own, set `GITLAB_URL` in `wrangler.jsonc`'s `vars`.
