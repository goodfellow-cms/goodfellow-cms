---
version: 1
title: Next.js
description: Goodfellow pages and the admin panel in a Next.js app, exported as static files, and how it compares with goodfellow build.
section: developers
order: 6
---

`@goodfellow-cms/next` puts a Goodfellow site in a Next.js app (App Router, Next.js 16), exported as static files so the same free hosts serve it. The **Starter for Next.js** has it all set up.

- `withGoodfellow()` in `next.config.ts` exports static files with a folder per page, serves the site from `basePath` (or `GOODFELLOW_BASE`), and in `next dev` runs the admin panel's local backend, which saves to the files on disk. The local backend is never part of a build.
- `goodfellowPages(config)` gives the routes their parts: `Layout` for `app/(site)/layout.tsx`, which shows the header and footer once around every page, so they stay as they are when moving between pages (menus mark the current page in the browser, since a layout doesn't know it); `Page`, `generateStaticParams` and `generateMetadata` for `app/(site)/[[...path]]/page.tsx`; `NotFound` for `app/not-found.tsx`, with the header and footer of its own, since Next.js shows it outside the layout; `sitemap` and `robots`, and `demoContent` for `app/admin/demo-content.json/route.ts`, which serves a [demo's](/docs/demo-mode) content.
- `<GoodfellowAdmin config={config} />` from `@goodfellow-cms/next/admin` is the admin panel, in a Client Component at `app/admin/page.tsx`.
- Pages render as Server Components. Links between the site's pages use `next/link`, so moving between pages doesn't reload, and images use `next/image` with their sizes filled in. Images are served as they are unless the site sets a custom image loader, since a static export can't resize them on request.
- Blocks can render Client Components with any React hooks, and they run in the browser. They can read the site with `useSite()`.
- After `next build`, the starter's build script runs `goodfellow-next finish out`, which writes the [calendar files](/docs/calendars#adding-to-calendars-and-subscribing) of collections of events, and the [search index](/docs/search) if a page has a Search block. In `next dev`, calendar files come from the local backend. On Windows, it also moves the files Next.js uses to load pages ahead to where browsers look for them, since Next.js writes them into folders there. Keep it in your build script.

## Compared with goodfellow build

Interactive blocks work with both, but `goodfellow build` runs each Client Component as a separate [island](/docs/interactive-blocks#what-islands-cant-do), which can't share React context, can't change the content it's given, takes only plain props, and starts again on every page.

Next.js suits developers who want client-side navigation, their own Next.js pages beside the site's, or Next.js's ecosystem. It costs more: each page loads Next.js's JavaScript and carries its content again as data, builds take longer, and there are more dependencies to keep up to date. Most of Next.js's server features don't apply, because Goodfellow sites are static, unless the app is a [full-stack site](/docs/full-stack-nextjs) with a server of its own. For a content site with a few interactive parts at most, `goodfellow build` is lighter and simpler.
