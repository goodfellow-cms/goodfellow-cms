---
version: 1
title: Security
description: What keeps a Goodfellow site and its editors' sign-in safe, what an admin address or a token broker adds, and where each protection stops.
section: owners
order: 2.5
---

A Goodfellow site is static files: there's no server or database to break into, and visitors only ever get pages. What needs keeping safe is the site's repository, which anyone who can publish to it controls, and so the sign-in that lets editors publish. This page says what protects them, for owners and editors first, then in detail for developers.

## For owners and editors

- **Editors sign in to GitHub or GitLab,** with their own account, and can do there only what the site's repository lets them. Every change is in the site's [version history](/docs/publishing), with who made it, and can be put back.
- **The admin panel keeps the sign-in in the browser,** where the editor chose: until the tab closes, or with **Stay signed in** until they sign out. Signing out forgets it, and AI keys with it.
- **The site's own code never runs where the sign-in is.** The editor, blocks and previews run in sandboxed frames that can't reach the admin panel's page, its storage or the internet.
- **The site's pages are another matter:** code pasted into Site Settings, such as analytics, runs on them. Without an admin address or a token broker, the admin panel shares an address with those pages, or on `github.io` and `gitlab.io` with every site in the same account, so such code could read a sign-in kept with **Stay signed in**. That's why, without one, the admin panel adds blocks only from Goodfellow's own registry.

Two things close that gap, and owners choose one on **Site Settings**:

- **An admin address,** such as `admin.example.org`, on a domain you already have: the admin panel moves there, and the site's pages can't reach it. It needs a host that serves a site at more than one address: GitLab Pages, Cloudflare Pages or Vercel, not GitHub Pages. See [An admin address](/docs/custom-domains#an-admin-address).
- **A token broker,** a sign-in page of its own: editors sign in there, it keeps their sign-in and AI keys, and shows the admin panel in a frame. Nothing on the site, the admin panel included, can read them, and it asks the editor before publishing the site's code. It works on any host, needs no domain on GitLab, and **Add a token broker** on the Security tab makes it. See [Token broker](/docs/token-broker).

Either one lets the Blocks screen offer blocks from other registries too. The [setup page](/new-site/) and `create-goodfellow` offer both for new sites.

## Builds

The site is built by GitHub Actions, GitLab CI, Cloudflare Pages or Vercel, from its repository.

- **No secrets, no publishing (GitHub):** in the starters' workflows, each job has only the permissions it needs. The jobs that run the site's code can only read the repository and keep no credentials, the job that puts the site online runs none of its code, and the nightly update builds the site with the update before a separate job, which runs none of its code, publishes it.
- **No install scripts:** sites' `.npmrc` turns off packages' install scripts, code a package runs when it's installed, since none of a site's packages need one.
- **Updates are checked first:** an update is published only once the site builds with it, and an owner can [go back](/docs/updates) to the release before.
- **GitLab** gives every job in a project the same token, so once automatic updates are turned on, any job in the site's pipeline can publish.

## For developers

- **The editor's sandbox:** Puck, the site's config and every block run in frames sandboxed with `allow-scripts` alone, whose origin is `null`. Their Content Security Policy runs only the site's own scripts and lets them fetch nothing, and their first script removes WebRTC. A sandboxed page can still go to another address, so the policy limits what blocks can send without sealing it; the sandbox is what keeps the sign-in out of their reach. The admin panel's own page has a policy too, `frame-src 'self'`, so its frames only ever show the editor's pages.
- **Messages:** the frames talk to the admin panel through one message port, and the admin panel checks everything they send as the site's code may have written it. Publish is drawn outside them.
- **Admin addresses:** every page a build writes starts with a script that stops it at the admin address, which builds check for in every HTML, SVG and XML file, and Cloudflare Pages and Vercel also get headers that sandbox anything else served there. The admin panel starts only at its own address.
- **The token broker** answers only what the admin panel uses, refuses workflow files, and asks in its own part of the page before publishing code, custom code or a new Site address, starting an update or giving someone access. The sign-in service gives tokens only to it once the site names one.
- **Sign-in service:** the [sign-in service](/docs/sign-in-service) keeps nothing but sealed sessions, revokes each person's own GitHub token once it knows who they are, and gives the admin panel an hour's token for the one repository, only at the site's addresses.
- **Uploads** are checked before they're published: types that could run code on the site's address are refused, scripts are removed from SVGs, and photos lose their location details.
- **Rich text and embeds** are sanitized, and players from other sites run in sandboxed frames. Custom HTML used as written is shown in the editor only in a frame sandboxed with nothing allowed.
- **Where it stops:** the site's pages have no Content Security Policy, so code pasted into Site Settings can still do anything on them, such as change what visitors see; what's kept from it is the sign-in. Whoever controls code in the admin panel's frame can still read and publish content while an editor is signed in, with or without a broker. Automated checks find only some problems.

### Going further

- **[Content in a repository of its own](/docs/content-repository):** editors' sign-in reaches only the content's repository, so it can never change the site's code.
- **[Full-stack Next.js sites](/docs/full-stack-nextjs)** sign editors in with the app's own sign-in, and their server holds the repository's token. The editor's sandbox still keeps blocks away from the app's API, but the app's server, sign-in, pages and secrets are their developers' to secure, and the token broker, admin addresses and the starters' builds don't apply to them.
- **[Running your own sign-in service](/docs/sign-in-service)** and **[token broker](/docs/token-broker)**.

## Reporting a security problem

Please report security problems privately, as the repository's [security policy](https://github.com/goodfellow-cms/goodfellow-cms/security/policy) says, rather than in a public issue.
