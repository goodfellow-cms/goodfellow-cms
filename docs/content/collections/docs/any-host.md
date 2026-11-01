---
version: 1
title: Host anywhere
description: Putting a site on any host, such as AWS, Google Cloud, DigitalOcean or a server of your own, with a build you set up yourself.
section: start
order: 4.5
---

A Goodfellow site is static files: pages, pictures, the admin panel and everything else are written by the build, and nothing runs on a server. So any host that serves files can serve one, such as Amazon S3 with CloudFront, Google Cloud Storage or Firebase Hosting, DigitalOcean's App Platform or Spaces, Azure Static Web Apps, Render, or a server of your own with nginx or Apache. [Put it online](/docs/put-it-online) gives the setup files for GitHub Pages, GitLab Pages, Cloudflare Pages, Netlify and Vercel; on any other host, you set up the build yourself, as this page describes. A [full-stack Next.js site](/docs/full-stack-nextjs) runs on any host that runs Node.js.

## Building the site

Make the site as usual, choosing **Not decided yet** for the host, then delete the setup files of the hosts you don't use. The site is still stored on GitHub, GitLab or Bitbucket, where the admin panel publishes to, so your build starts from the repository's main branch:

1. `npm ci`, to install exactly what `package-lock.json` names.
2. `npm run build`, which writes the site into `dist/` (`out/` for the Next.js starter, whose build script runs `next build` and then `goodfellow-next finish out`).
3. Copy that folder to the host, such as with `aws s3 sync dist/ s3://your-bucket --delete`.

If the host serves the site from a subfolder, such as `https://example.org/parish/`, build it with `GOODFELLOW_BASE=/parish/` (see [Commands](/docs/commands#serving-from-a-subfolder)). Put the site's address in **Site Settings → General → Site address**, since search engines, feeds and link previews need full addresses.

Build again whenever the main branch changes, since every Publish in the admin panel is a change there. Most hosts and CI services can start a build on every push; the starters' GitHub workflow, `.github/workflows/deploy.yml`, is a good place to start from: keep its jobs and replace the one that publishes to GitHub Pages with your host's upload. That keeps what the rest of it does, below.

## What the host needs to do

- **Serve each page's folder:** the build writes each page as a folder with an `index.html`, such as `about/index.html` for `/about`. Most hosts serve those by themselves; on S3 that means the bucket's website endpoint, or CloudFront with a function that adds `index.html`, and on nginx `try_files $uri $uri/ =404;`.
- **Show "Page not found":** point the host's error page at `404.html` (S3's error document, nginx's `error_page 404 /404.html;`).
- **Send the right types:** files are named by what they are, so hosts that go by the name send the right type. Check that `.ics` is sent as `text/calendar`, `.rss` and `.atom` as XML, and `.webp` and `.woff2` as what they are, if the host doesn't know them.
- **End addresses as the host does:** see [Addresses with or without a slash](#addresses-with-or-without-a-slash).
- **Send the site's headers,** where the host lets you: the build writes them into `_headers` in the folder it builds, in the form Cloudflare Pages and Netlify read, so those two send them as they are. Elsewhere, set the same rules in the host's own settings, such as a CloudFront response headers policy or nginx's `add_header`. They're safer settings for every page, the media library's SVGs sandboxed, and the admin panel's own (see [Security](/docs/security#for-developers)).
- **Send old addresses on:** the build writes a page at each of the site's [redirects](/docs/layout-and-settings#redirects)' old addresses that sends visitors on, which works on every host. It also lists them in `_redirects`, which Cloudflare Pages and Netlify send themselves.

## Addresses with or without a slash

Hosts differ in which address they serve a folder's page at: GitHub Pages, Cloudflare Pages and Netlify serve `/about/` and send `/about` there, while others, such as Vercel with `trailingSlash: false`, do the opposite, and some serve both. The site tells search engines each page's address, in its canonical link, sitemap, `hreflang` links, feeds, calendar files and structured data, so it should be the one the host serves without sending visitors on. Links from one page to another, in menus, buttons and text, end the same way, so following them doesn't go through a redirect either.

By default those addresses end with a slash (`https://example.org/about/`), as most hosts serve the folders the build writes. Where yours serves them without one, set it in `goodfellow.config.tsx`:

```tsx
export default defineConfig({
  trailingSlash: false,
  // …
});
```

`GOODFELLOW_TRAILING_SLASH=false` where the site is built does the same, and wins over the config. On the Next.js starter, set Next.js's own `trailingSlash` in `next.config.ts` instead, which also decides how Next.js writes its pages: as folders (`true`, the default), or as `about.html` (`false`).

## Keeping it up to date

The starters' setup files do three more things, which your build can do with the same commands:

- **Rebuild overnight**, so pages that show what's coming up stay current: run `npx goodfellow nightly` each night, and build when it says so (see [Rebuilding overnight](/docs/updates#rebuilding-overnight)), or simply build every night.
- **Publish scheduled pages on time:** run `npx goodfellow due` every hour, and build when it says something came due (see [Scheduling](/docs/scheduling)). Without it, scheduled changes go live with the next build.
- **Install fixes:** `npx goodfellow update --publish` installs Goodfellow's fixes, if the site still builds with them, and publishes them (see [Keeping a site up to date](/docs/updates)). The admin panel's Updates screen follows the starters' GitHub workflow and GitLab pipeline, so on a setup of your own it only explains.

Next.js sites use `goodfellow-next` in place of `goodfellow`.

## The admin panel

The admin panel is part of the build, at `/admin`, so it works wherever the site is. Editors sign in with a token, or with a [sign-in service](/docs/sign-in-service) or [token broker](/docs/token-broker) of your own. Where your build runs on GitHub Actions or GitLab CI/CD, the admin panel shows whether the site is rebuilding after a publish, and what went wrong if it failed.

To give the admin panel an [address of its own](/docs/custom-domains#an-admin-address) on a host of your choosing, run `npx goodfellow admin add admin.example.org`, connect that address to the same files at the host, and have the host send `Content-Security-Policy: sandbox` with every page there but the admin panel, as `_headers` lists. Once the site has rebuilt, `npx goodfellow admin check` checks it and starts the admin panel only there.

To connect a domain, use the host's own settings, then put the new address in **Site Settings → General → Site address** and publish.
