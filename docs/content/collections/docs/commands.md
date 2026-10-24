---
version: 1
title: Commands
description: goodfellow dev, build, preview, index, update, due, nightly, content and import, and serving a site from a subfolder.
section: developers
order: 5
---

| Command | What it does |
|---|---|
| `goodfellow dev` | Serves the site, rendering each page from the files on disk, plus the admin panel at `/admin`, which saves to those files |
| `goodfellow build` | Writes one HTML file per page that's shown at the time (see [Scheduled publishing](/docs/scheduling)) to `dist/`, builds the CSS and copies `public/`. Also writes `sitemap.xml` (without pages hidden from search engines), `robots.txt` and [feeds](/docs/search-engines#feeds) of dated collections if the site's address is set, the admin panel if the config has a `backend` or `demo`, the JavaScript for [Client Components](/docs/interactive-blocks), [calendar files and month pages](/docs/calendars) for collections of events, lists' [later pages and pages for each choice](/docs/showing-collections#pages-of-items), a page at each [redirect's](/docs/layout-and-settings#redirects) old address and `_redirects` for Cloudflare Pages, a copy of the site's Google Fonts in `fonts/google/`, which its pages load in place of Google's, a [search index](/docs/search) if a page has a Search block, and `goodfellow-build.json`, which says what the site was built from and when what it shows by today's date next changes, for the [nightly check](/docs/updates#rebuilding-overnight). For a site in a subfolder, it says where search engines look for `robots.txt` (see [Sites in a subfolder](/docs/search-engines#sites-in-a-subfolder)) |
| `goodfellow preview` | Serves `dist/` the way a host would, including the "Page not found" page |
| `goodfellow index` | Writes the search index for a site built another way |
| `goodfellow update` | Updates Goodfellow, and blocks from its registry, if the site still builds with the update (see [Keeping a site up to date](/docs/updates)) |
| `goodfellow due [--since <time>]` | Says whether a [scheduled](/docs/scheduling) page or item has been shown or hidden since `--since` (an ISO time; the last hour without one), so the site needs building again. On GitHub Actions it also sets the step's `due` output to `true` or `false`, which the starters' hourly check reads. It's also due the first check after the live site's `goodfellow-build.json` says what it shows by today's date changes |
| `goodfellow nightly [--mode <mode>] [--output <file>]` | Says whether tonight's build is needed: when the site has changed since the live site was built, something it shows by today's date has, or an update is available, reading the live site's `goodfellow-build.json`. `--mode` (or `GOODFELLOW_NIGHTLY`) is `changed`, the default, `always` or `off`. On GitHub Actions it sets the step's `build` and `update` outputs, or adds them to `--output`; see [Rebuilding overnight](/docs/updates#rebuilding-overnight) |
| `goodfellow content link [folder]` | For a site whose [content is in a repository of its own](/docs/content-repository): links `content/` and `public/media/` to it, in `folder` (default: `content-repository`), so `goodfellow dev` reads and saves its files |
| `goodfellow content copy [folder]` | Copies them from it instead, as builds do |
| `goodfellow broker add [folder] --host <host>` | Writes the site's [token broker](/docs/token-broker)'s repository into `folder` (default: beside the site's, named after it with `-signin`), for `github-pages` (with `--domain`), `gitlab-pages`, `cloudflare-pages` or `vercel` |
| `goodfellow broker use <address>` | Signs editors in at the token broker from then on, once the site has rebuilt; `goodfellow broker remove` stops it |
| `goodfellow admin add <address>` | Names the admin panel's [address of its own](/docs/custom-domains#an-admin-address), such as `admin.example.org`, in `goodfellow.config.tsx`, for sites whose config the admin panel can't publish, such as those whose [content is in a repository of its own](/docs/custom-domains#with-a-content-repository) |
| `goodfellow admin check` | Once the site has rebuilt with it, checks that the site's pages at the admin address leave it before running anything, then marks it checked, from which the admin panel opens only there; `goodfellow admin remove` stops using it |
| `goodfellow import wordpress <file or address>` | Brings a WordPress site's pages, posts, categories, tags, menus and media into the site, from its export file or its address (see [Move from WordPress](/docs/move-from-wordpress)). `--dry-run` says what would come across and changes nothing |
| `goodfellow export wordpress [file]` | Writes the site as a WordPress export file, at `file` or in a file named after the site, which WordPress imports with **Tools → Import → WordPress** (see [Move from WordPress](/docs/move-from-wordpress#moving-to-wordpress)) |

Next.js sites have the same `update`, `due`, `nightly`, `content`, `admin`, `import` and `export` commands as `goodfellow-next update`, `goodfellow-next due`, `goodfellow-next nightly`, `goodfellow-next content`, `goodfellow-next admin`, `goodfellow-next import` and `goodfellow-next export`, and `goodfellow-next broker use` and `remove`.

Options: `--root <dir>`, `--out <dir>`, `--port <port>`, `--base <path>` and, for `import`, `--dry-run`.

## Site checks

`goodfellow build` ends with what the [site checks](/docs/publishing#site-checks) find, the same ones the admin panel runs when publishing: links to pages, items and media the site doesn't have are errors, and pages without a title or description, and theme colors text is hard to read on, are warnings. On GitHub Actions each also shows as an annotation on its file. They don't stop the build, so a link broken outside the admin panel, such as by deleting a file in the repository, never takes the site down; `goodfellow build --strict` fails the build when there are errors, for checking changes made in code before they're merged.

It then checks every built page for accessibility problems: the ones the admin panel warns about (images without a description, headings that skip a level, and links that don't say where they go), and the rules of [axe-core](https://github.com/dequelabs/axe-core), the checker browsers' developer tools use, each explained in plain words, such as a form field without a label or a frame without a title. Problems in the header and footer are listed once, not for every page. Automated checks find only some accessibility problems, so a build with none doesn't mean the site is accessible: try it with a keyboard and a screen reader too. Contrast is checked on the theme's colors, not on built pages, since that needs a browser.

Next.js sites get the checks of built pages from `goodfellow-next finish`; the checks of content files don't run in `next build` yet.

`goodfellow dev` uses port 4321, or the next free one if another program has it, and `goodfellow preview` uses 4322. Each prints its address when it starts.

## Serving from a subfolder

Some hosts serve a site from a subfolder, such as `/my-repo/` on GitHub Pages. The base path comes from `--base`, then the `GOODFELLOW_BASE` environment variable, then `base` in `goodfellow.config.tsx`. Every root-relative link and image in the built pages is adjusted to match, including links inside formatted and Markdown text.

The site's address (Site Settings → General) should be the full public address, subfolder included.
