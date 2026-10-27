---
version: 1
title: Staging and production
description: Building a staging copy of a site from another branch of the same repository, at its own address and kept out of search engines, and moving changes from it to the live site.
section: developers
order: 7.6
---

Some organizations try every change on a staging site before it goes live: a change to the `staging` branch builds the staging site, and merging `staging` into `main` builds the live one. Goodfellow doesn't set up those pipelines, but it works with them. Both sites are built from one repository, or one code repository and one [content repository](/docs/content-repository), with the same config. What differs is set where each one is built, in environment variables.

| What | Where it's set | For staging |
|---|---|---|
| The branch editors publish to | The backend's `branch`, read from an environment variable in the config | `staging` |
| The site's address | `GOODFELLOW_SITE_URL` | `https://staging.example.org` |
| Search engines | `GOODFELLOW_NO_INDEX` | `true` |

None of these are in content. Merging `staging` into `main` brings the content with it, but not the staging site's address or its search engine setting.

## The branch editors publish to

The config is read when the site is built, so the backend can take its branch from the build's environment:

```tsx
export default defineConfig({
  blocks: { ...blocks, ...installedBlocks },
  backend: github({ repo: "your-org/your-site", branch: process.env.SITE_BRANCH ?? "main" }),
});
```

Name the variable whatever you like. The staging build sets `SITE_BRANCH=staging`, and the admin panel built with it publishes there. Drafts, scheduled changes, plugins' tasks and the Updates screen follow the same branch. `gitlab()` and `bitbucket()` take `branch` too.

Builds bake the config into the admin panel and into `goodfellow-site.json`, both of which anyone can read. Never put a secret in the config, even from an environment variable.

## The staging site's address

Site Settings' **Site address** is the live site's. The staging build sets the address it's at instead:

```sh
GOODFELLOW_SITE_URL=https://staging.example.org GOODFELLOW_NO_INDEX=true npm run build
```

- **`GOODFELLOW_SITE_URL`** replaces the Site address wherever the build uses it: canonical links, the sitemap and `robots.txt`, feeds, calendar files, link previews, redirect pages and the nightly check. Use the full address, with any subfolder.
- **`GOODFELLOW_NO_INDEX=true`** asks search engines not to list any of the staging site's pages, as each page's own **Search engines** setting does, and leaves them all out of the sitemap.

Both apply to `goodfellow build` and `goodfellow dev`. On a Next.js site, set them for `next build` and `goodfellow-next finish` alike, since both read the Site address. Without them, a build is the live site's.

The admin panel never saves either one: editing Site Settings on staging saves the live site's address, as it should, and the Domain screen says the staging site's address is set where it's built. A search engine setting asks politely. To keep staging private, also put it behind your host's protection, such as Vercel's or Cloudflare Access.

## Signing in to the staging site

Signing in with a token works on both sites. On GitHub, the [sign-in service](/docs/sign-in-service) gives tokens only to the addresses the live site names. To let editors use **Sign in with GitHub** on staging too, list the staging site's address in the config's `copies`:

```tsx
export default defineConfig({
  // …
  copies: ["https://staging.example.org"],
});
```

Builds publish `copies` in `goodfellow-site.json`, and the service reads it from the live site, so it takes effect once the live site has been built with it. Each address must be `https://`, and never this computer.

On GitLab, add the staging site's admin panel, such as `https://staging.example.org/admin/`, to the redirect URIs of the application editors sign in with. A Bitbucket OAuth consumer has only one callback URL, so give staging a consumer of its own and take `clientId` from the environment too. A consumer's key isn't a secret.

Some things are the live site's alone:

- **The admin address.** The staging site leaves out the config's `admin` and keeps its admin panel at its own `/admin`, so that it publishes to staging. That address is shared with the staging site's pages, as on a site without an admin address. So the staging admin panel installs no plugins, and adds blocks only from Goodfellow's registry.
- **A token broker** shows only the live site's admin panel. On a site with one, editors sign in to staging with a token.

## Moving changes to the live site

Pick one branch where editors publish:

- **Editors publish on staging,** and changes go live when `staging` is merged into `main`. To keep editors off the live site's admin panel, a `goodfellow build` site can leave the live build without one, since builds add the admin panel only with a `backend`: `backend: process.env.SITE_BRANCH ? github({ … }) : undefined`. On a Next.js site, `app/admin/` is part of every build, so tell editors which admin panel to use.
- **Editors publish to the live site,** and staging is only for developers' changes. Merge `main` into `staging` often, so staging shows today's content.

Either way, someone else's change to the same files shows up as a conflict when the branches are merged, never as a lost change. Merge with your git host, not the admin panel.

**Automatic updates** commit to the branch their job runs on. Run them on one branch only. On staging, an update is tried there first and goes live with the next merge. On `main`, merge `main` back into `staging` afterwards. The starters' workflows run on `main`; your pipelines decide where they run for staging.

## Media and plugins

The staging site shows the same media library: `public/media/` is in the repository, and media kept by a plugin, such as [S3 storage](/docs/plugins#keeping-media), comes from the same storage, since content refers to its files. Uploading on staging adds files the live site will refer to once it's merged, so share the bucket rather than giving staging one of its own.

Plugins' options and secrets can come from the environment too, like the branch. Their tasks run in the CI of the branch the admin panel publishes to, with that branch's secrets.

## With a content repository

With the content in a [repository of its own](/docs/content-repository), give the content repository the `staging` branch. The code's branch can stay `main` for both sites, or have a `staging` branch of its own. The staging build checks out both at their staging branches, puts the content in place with `goodfellow content copy`, and sets the same variables.
