---
version: 1
title: Security
description: What keeps a Goodfellow site and its editors' sign-in safe, what an admin address or a token broker adds, which setup to choose, and where each protection stops.
section: owners
order: 2.5
---

A Goodfellow site is static files: there's no server or database to break into, and visitors only ever get pages. What needs keeping safe is the site's repository, which anyone who can publish to it controls, and so the sign-in that lets editors publish. This page says what protects them, for owners and editors first, then in detail for developers.

## For owners and editors

- **Editors sign in to GitHub, GitLab or Bitbucket,** with their own account or a token for the site, and can do there only what the site's repository lets them. Every change is in the site's [version history](/docs/publishing), with who made it, and can be put back.
- **The admin panel keeps the sign-in in the browser,** where the editor chose: until the tab closes, or with **Stay signed in** until they sign out. Signing out forgets it, and AI keys with it.
- **The site's own code never runs where the sign-in is.** The editor, blocks and previews run in sandboxed frames that can't reach the admin panel's page, its storage or the internet.
- **The site's pages are another matter:** code pasted into Site Settings, such as analytics, runs on them. Without an admin address or a token broker, the admin panel shares an address with those pages, or on `github.io` and `gitlab.io` with every site in the same account, so such code could read a sign-in kept with **Stay signed in**. That's why, without one, the admin panel adds blocks only from Goodfellow's own registry, and installs no [plugins](/docs/plugins#install-a-plugin-from-the-admin-panel).

Two things close that gap, and owners choose one on **Site Settings**:

- **An admin address,** such as `admin.example.org`, on a domain you already have: the admin panel moves there, and the site's pages can't reach it. It needs a host that serves a site at more than one address: GitLab Pages, Cloudflare Pages or Vercel, not GitHub Pages. See [An admin address](/docs/custom-domains#an-admin-address).
- **A token broker,** a sign-in page of its own: editors sign in there, it keeps their sign-in and AI keys, and shows the admin panel in a frame. Nothing on the site, the admin panel included, can read them, and it asks the editor before publishing the site's code. It works on any host, needs no domain on GitLab, and **Add a token broker** on the Security tab makes it. See [Token broker](/docs/token-broker).

Either one lets the Blocks screen offer blocks from other registries too. The [setup page](/new-site/) and `create-goodfellow` offer both for new sites.

## Recommendations

Three setups, from the least to set up to the most secure. Each keeps code on the site's pages away from editors' sign-in; the further ones also narrow what a sign-in can reach and who can change the site's code.

### Simplest

On GitLab, either:

- **One project, with an admin address:** the site at your domain, such as `example.org`, and the admin panel at another, such as `admin.example.org`, both served by GitLab Pages from the site's project. See [An admin address](/docs/custom-domains#an-admin-address).
- **The site's project and a token broker's, with or without a domain:** **Add a token broker** on the Security tab makes the broker's project, at a domain of yours, such as `signin.example.org`, or at its own address on GitLab. The broker keeps the sign-in out of the admin panel altogether and asks before anything but content is published, so it protects more than an admin address, for one more project.

On GitLab, a sign-in reaches every project the editor's account can, not only the site's, so editors should use an account, or a group, that's only for the site. And once automatic updates are on, any job in the site's pipeline can publish to it.

On Bitbucket, whose sites Vercel hosts, the same two: an admin address, which Vercel serves from the site's project, or a token broker on Vercel. Give each editor a repository access token, which reaches the site's repository alone, rather than an API token or Sign in with Bitbucket, which reach everything the editor's account can. Every pipeline step can publish to the repository and read its variables.

### In between

On GitHub, one repository, with the [sign-in service](/docs/sign-in-service) and a [token broker](/docs/token-broker):

- **The sign-in service** gives the admin panel tokens for the site's repository alone, for an hour, with only the permissions it needs, and revokes the editor's own GitHub token as soon as it knows who they are. It's a Cloudflare Worker you run yourself; without it, fine-grained tokens limited to the site's repository are almost as narrow, but editors make and renew them themselves.
- **The token broker** keeps those tokens away from the admin panel, and asks before anything but content is published. On GitHub Pages, it needs a domain of its own, such as `signin.example.org`.

### Most secure

The setup in between, with the site's content in a [repository of its own](/docs/content-repository): editors' sign-in can change content and media but never the site's code, and the sign-in service only lets them read the code's repository. Then, on GitHub:

- Require two-factor authentication in the site's organization.
- Protect the code's main branch, so that changes to it need a review.
- Keep the people who can push to the code's repository and the broker's to the few who need to: whoever can change the code controls the site, and whoever can change the broker controls its sign-in.
- Leave **Install fixes automatically each night** on, so security fixes arrive without waiting for anyone.
- On Cloudflare Pages or Vercel, give the admin panel an address of its own too, which a developer [finishes in the code](/docs/custom-domains#with-a-content-repository). With a broker, the admin panel holds no sign-in, so what it adds is small: the site's pages can't reach the admin panel's preferences, or any window of it they're given.

## Why the admin panel is always at /admin

Many systems let owners move their admin pages, such as WordPress's `/wp-admin`, to an address only they know, so that automated attacks don't find them. Goodfellow keeps its admin panel at `/admin`, because there's nothing there for such attacks to find:

- **There's no password to guess.** The admin panel has no sign-in form of its own: editors sign in to GitHub, GitLab or Bitbucket, or paste a token for the site, so any guessing happens at the git host, which limits attempts and can ask for two-factor authentication.
- **There's nothing behind it to break into.** `/admin` is static files, the same for every Goodfellow site and published openly with Goodfellow itself, with no server code or database behind them. Hiding them would hide nothing secret, and requests for them cost the site nothing.
- **It's easy to find anyway.** Every site's build publishes `goodfellow-site.json`, which says it's a Goodfellow site, so a different address would only slow an attack for as long as it took to look.

What does protect the admin panel is keeping the site's pages away from editors' sign-in, with [an admin address or a token broker](#for-owners-and-editors), and the git host's own protections: two-factor authentication, and tokens that reach the site's repository alone.

Search engines are asked not to list the admin panel: its pages, the editor's frames and plugins' frames all say `noindex`, and sitemaps leave them out. `robots.txt` doesn't name `/admin`, since that would only point to it.

## Builds

The site is built by GitHub Actions, GitLab CI, Cloudflare Pages or Vercel, from its repository, and on Bitbucket, Pipelines run its nightly update and plugins' tasks.

- **No secrets, no publishing (GitHub):** in the starters' workflows, each job has only the permissions it needs. The jobs that run the site's code can only read the repository and keep no credentials, the job that puts the site online runs none of its code, and the nightly update builds the site with the update before a separate job, which runs none of its code, publishes it.
- **No install scripts:** sites' `.npmrc` turns off packages' install scripts, code a package runs when it's installed, since none of a site's packages need one.
- **Lockfiles written without running anything:** when a plugin is installed from the admin panel, the site's build writes `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, which installs nothing, and takes only releases at least three days old for what it adds.
- **Plugins' tasks keep their secrets in the build:** a [task](/docs/plugins#tasks), such as S3 storage signing uploads, runs in the site's CI with only the secrets its plugin declared, in a process that can't read the rest of the site, write files or start programs, and its answer is sealed to a key that only the admin panel that asked holds. On GitHub, the job that runs it can only read the repository, and a separate job, which runs none of the site's code, leaves the answer on a branch of its own. The secrets never reach the admin panel or an editor's browser.
- **Updates are checked first:** an update is published only once the site builds with it, and an owner can [go back](/docs/updates) to the release before.
- **GitLab** gives every job in a project the same token, so once automatic updates are turned on, any job in the site's pipeline can publish.
- **Bitbucket** lets every pipeline step publish, and gives each one every repository variable, so a plugin's task gets only the secrets it declared, but the site's other pipelines could read the rest. Keep only what the site needs in the repository's variables.

## For developers

- **The editor's sandbox:** Puck, the site's config and every block run in frames sandboxed with `allow-scripts` alone, whose origin is `null`. Their Content Security Policy runs only the site's own scripts and lets them fetch nothing, and their first script removes WebRTC. A sandboxed page can still go to another address, so the policy limits what blocks can send without sealing it; the sandbox is what keeps the sign-in out of their reach. The admin panel's own page has a policy too, `frame-src 'self'`, so its frames only ever show the editor's pages.
- **Messages:** the frames talk to the admin panel through one message port, and the admin panel checks everything they send as the site's code may have written it. Publish is drawn outside them.
- **Admin addresses:** every page a build writes starts with a script that stops it at the admin address, which builds check for in every HTML, SVG and XML file, and Cloudflare Pages and Vercel also get headers that sandbox anything else served there. The admin panel starts only at its own address.
- **The token broker** answers only what the admin panel uses, refuses workflow files, and asks in its own part of the page before publishing code, custom code or a new Site address (however the settings file is written, or deleted), starting an update or giving someone access. The sign-in service gives tokens only to it once the site names one.
- **Sign-in service:** the [sign-in service](/docs/sign-in-service) keeps nothing but sealed sessions, revokes each person's own GitHub token once it knows who they are, and gives the admin panel an hour's token for the one repository, only at the site's addresses.
- **Uploads** are checked before they're published: types that could run code on the site's address are refused, SVGs keep only what they draw with (no scripts, embedded pages, event handlers or links to scripts, however they're spelled), and photos lose their location details.
- **Rich text and embeds** are sanitized, and players from other sites run in sandboxed frames. Custom HTML used as written is shown in the editor only in a frame sandboxed with nothing allowed.
- **Where it stops:** the site's pages have no Content Security Policy, so code pasted into Site Settings can still do anything on them, such as change what visitors see; what's kept from it is the sign-in. Whoever controls code in the admin panel's frame can still read and publish content while an editor is signed in, with or without a broker. Automated checks find only some problems.

### Going further

- **[Content in a repository of its own](/docs/content-repository):** editors' sign-in reaches only the content's repository, so it can never change the site's code.
- **[Full-stack Next.js sites](/docs/full-stack-nextjs)** sign editors in with the app's own sign-in, and their server holds the repository's token. The editor's sandbox still keeps blocks away from the app's API, but the app's server, sign-in, pages and secrets are their developers' to secure, and the token broker, admin addresses and the starters' builds don't apply to them.
- **[Running your own sign-in service](/docs/sign-in-service)** and **[token broker](/docs/token-broker)**.

## Reporting a security problem

Please report security problems privately, as the repository's [security policy](https://github.com/goodfellow-cms/goodfellow-cms/security/policy) says, rather than in a public issue.
