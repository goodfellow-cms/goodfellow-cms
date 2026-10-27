---
version: 1
title: Token broker
description: A sign-in page of its own that keeps editors' tokens and AI keys away from the site's pages, and putting one online.
section: developers
order: 10.5
---

Without a token broker, the admin panel keeps an editor's sign-in where they choose, in the browser, at the admin panel's own address. That's the site's address, or on `github.io` and `gitlab.io` an address every site in the same account shares, so a script on one of those pages, such as code pasted into Site Settings, could read a sign-in kept with **Stay signed in**. An [admin address](/docs/custom-domains#an-admin-address) moves the admin panel to an address of its own; a token broker goes further, and works on any host.

The broker is a small static page on an address that serves nothing else. Editors sign in there. It keeps their sign-in, and their keys for AI services, in its own storage, and shows the site's admin panel in a frame. The admin panel never signs in itself: it asks the broker, through messages, to read files and publish changes, and the broker makes every call to GitHub, GitLab or Bitbucket and AI services. Nothing on the site's address, or the admin panel's, can read the tokens, Goodfellow's own code included.

## What it checks

Whoever runs code in the admin panel's frame can ask the broker for anything the admin panel can, so the broker checks every request:

- **Only what the admin panel uses:** it answers reads, publishes, version history, the live site's updates, drafts, domains, editors and updates, and never the git host's API for anything else.
- **Never workflows:** it refuses to publish `.github/` or `.gitlab-ci.yml`, which run with the repository's secrets.
- **Editors' limits:** it refuses to publish changes outside what an owner [lets the editor change](/docs/sign-in#limiting-what-editors-can-change), so code in the admin panel's frame can't either. They can still go into a draft, for review.
- **Asks first, in its own part of the page,** outside the admin panel's frame, before publishing the site's code (installed blocks, `goodfellow.config.tsx`, `package.json` and anything else outside `content/` and `public/media/`), the site's own code that runs on its pages (`content/code/`), a new Site address (which is where it shows the admin panel from), installing a release of Goodfellow, or giving someone access to the site.
- **Owner tokens in its own dialog:** where a screen needs an owner token, the broker asks for it itself, and keeps it in memory only.
- **Only its own frame:** it talks only to the admin panel at the Site address (or a checked admin address), read from the repository, and refuses to be shown inside another page.

With a broker, the Blocks screen also offers blocks from the [registries the config lists](/docs/add-blocks#other-registries), since the broker asks before publishing their code.

## Putting one online

The quickest way is **Site Settings → Security → Add a token broker** in the site's admin panel. Choose where it goes online, and paste a token that can create repositories on GitHub or GitLab, or an Atlassian API token on Bitbucket, which is used only then. It makes the broker's repository beside the site's, from Goodfellow's released page and a `broker.json` naming the site:

- **GitLab Pages, at an address GitLab gives it:** the project's unique domain, which nothing else shares, so no domain is needed. Its address is under **Deploy → Pages** in the new project once its first build has finished.
- **GitHub Pages or GitLab Pages, at a domain of yours,** such as `signin.example.org`, which you point at the host as its Pages settings say. GitHub Pages needs one, since its own addresses are shared by every site in the same account.
- **Cloudflare Pages or Vercel:** the repository is made ready, and you connect it to a Cloudflare Pages or Vercel project, as its README says. A site on Bitbucket puts its broker on Vercel.

Once it's online, type its address on the same tab and choose **Sign in there from now on**.

From a computer, in the site's folder:

```sh
npx goodfellow broker add --host gitlab-pages          # or github-pages --domain signin.example.org, cloudflare-pages, vercel
npx goodfellow broker use https://signin.example.org   # once it's online
npx goodfellow broker remove                           # to stop using it
```

`broker add` writes the broker's repository into a folder beside the site's (or the one you name), as a git repository with everything in its first commit, for you to push to a repository of its own. New sites can start with a broker too: choose **At a sign-in page of its own** under **Where editors sign in** on the [setup page](/new-site/), or run `npm create goodfellow@latest -- --broker gitlab-pages`.

To set one up by hand instead, the broker is released as `@goodfellow-cms/broker`, whose `site/` folder is the whole page:

1. Make a repository for it, with nothing else in it, and copy in the `site/` folder of the release that matches your site's Goodfellow version, such as `https://cdn.jsdelivr.net/npm/@goodfellow-cms/broker@0.4.0/site/`.
2. Add `broker.json` beside `index.html`, naming the site's repository as its config's `backend` does (copy `broker.example.json`):

   ```json
   {
     "sites": [{ "package": "@goodfellow-cms/github", "export": "github", "options": { "repo": "your-name/your-site" } }]
   }
   ```

   An organization can list several sites; editors open `https://broker.example.org/?site=your-name/your-site`.
3. Put it online at an address of its own, which serves nothing else:
   - **Cloudflare Pages or Vercel:** any project address, or a domain of its own. The `_headers` and `vercel.json` files it comes with stop other pages from framing it.
   - **GitHub Pages or GitLab Pages:** only with a domain of its own, or on GitLab Pages with the project's unique domain setting on. Never a shared `github.io` or `gitlab.io` address, such as `your-name.github.io/broker`, which every Pages site in the same account or group shares.
4. **Sign in with GitHub:** if the site uses a [sign-in service](/docs/sign-in-service), name it in `broker.json`'s options too (`"signIn": "https://…"`). Once the site's build names the broker, the service gives tokens only to the broker. **Sign in with GitLab:** add the broker's address, with its trailing slash, to the redirect URIs of the GitLab application editors sign in with, and give `broker.json` its `clientId`. **Sign in with Bitbucket:** an OAuth consumer has one callback URL, so add a consumer for the broker, with its address as the callback URL, and give `broker.json` its Key as `clientId`.
5. In the admin panel, open **Site Settings → Security**, type the broker's address and choose **Sign in there from now on**. That publishes it in `goodfellow.config.tsx` (`broker: { url: "https://broker.example.org" }`). Once the site has rebuilt, the admin panel opens only inside the broker: opened at the site's address, it links to the broker instead of signing in, and forgets any sign-in it kept there.

**Stop using the sign-in page** on the same tab removes the line; the broker asks first, since it's the site's code.

## Where it stops

- **The site's pages** have no Content Security Policy, so code pasted into Site Settings can still do anything on them, such as change what visitors see. What the broker keeps from it is editors' tokens and AI keys.
- **The admin panel's own requests:** whoever controls code in the admin panel's frame can still read and publish content through the broker while an editor is signed in. The broker's questions cover what runs code; content changes are in the site's version history.
- **Editors' own access:** editors sign in to the broker with their own GitHub, GitLab or Bitbucket account, which can change any of the site's files on the host itself. The broker keeps the admin panel to their limits, not the editors: only a full-stack site's server holds everyone to them.
- **Full-stack Next.js sites** don't use a broker: their server keeps the repository's token, and editors sign in with the app's own sign-in (see [Full-stack Next.js sites](/docs/full-stack-nextjs)).
