---
version: 1
title: Commands
description: goodfellow dev, build, preview, index and update, and serving a site from a subfolder.
section: developers
order: 5
---

| Command | What it does |
|---|---|
| `goodfellow dev` | Serves the site, rendering each page from the files on disk, plus the admin panel at `/admin`, which saves to those files |
| `goodfellow build` | Writes one HTML file per page to `dist/`, builds the CSS and copies `public/`. Also writes `sitemap.xml` and `robots.txt` if the site's address is set, the admin panel if the config has a `backend` or `demo`, the JavaScript for [Client Components](/docs/interactive-blocks), [calendar files and month pages](/docs/calendars) for collections of events, lists' [later pages and pages for each choice](/docs/showing-collections#pages-of-items), and a [search index](/docs/search) if a page has a Search block |
| `goodfellow preview` | Serves `dist/` the way a host would, including the "Page not found" page |
| `goodfellow index` | Writes the search index for a site built another way |
| `goodfellow update` | Updates Goodfellow, and blocks from its registry, if the site still builds with the update (see [Keeping a site up to date](/docs/updates)) |
| `goodfellow content link [folder]` | For a site whose [content is in a repository of its own](/docs/content-repository): links `content/` and `public/media/` to it, in `folder` (default: `content-repository`), so `goodfellow dev` reads and saves its files |
| `goodfellow content copy [folder]` | Copies them from it instead, as builds do |

Next.js sites have the same `update` and `content` commands as `goodfellow-next update` and `goodfellow-next content`.

Options: `--root <dir>`, `--out <dir>`, `--port <port>`, and `--base <path>`.

`goodfellow dev` uses port 4321, or the next free one if another program has it, and `goodfellow preview` uses 4322. Each prints its address when it starts.

## Serving from a subfolder

Some hosts serve a site from a subfolder, such as `/my-repo/` on GitHub Pages. The base path comes from `--base`, then the `GOODFELLOW_BASE` environment variable, then `base` in `goodfellow.config.tsx`. Every root-relative link and image in the built pages is adjusted to match, including links inside formatted and Markdown text.

The site's address (Site Settings → General) should be the full public address, subfolder included.
