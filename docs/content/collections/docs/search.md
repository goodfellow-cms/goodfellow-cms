---
version: 1
title: Search
description: How the Search block works, how sites are indexed, and how other blocks can use the same index.
section: developers
order: 9
---

The **Search** block searches the whole site in the visitor's browser with [Pagefind](https://pagefind.app), or with [MiniSearch](https://lucaong.github.io/minisearch/) where the site chooses it. The index is made when the site is built, so no search service, server, or account is needed, and the index only loads when someone searches.

## Choosing what searches the site

Site Settings' General tab has a **Site search** section with three choices, kept in `content/site.json` as `search.engine`:

| Choice | `engine` | On the website | In [apps](/docs/apps) |
|---|---|---|---|
| **Best for websites** (the default) | `pagefind` | Pagefind | Pages' titles and items' fields only |
| **The same on the website and in apps** | `minisearch` | MiniSearch | MiniSearch, from the same index |
| **Best on each** | `both` | Pagefind | MiniSearch |

- **Pagefind** splits its index into small pieces and downloads only the ones a search needs, so it stays quick on sites with thousands of pages. It reduces words to their stems in each language, so "publishing" finds "publish". It runs on WebAssembly, which apps can't run, so apps search only what they already keep: pages' titles and items' fields.
- **MiniSearch** is plain JavaScript, so the website and apps run the same search on the same index file and find the same pages, in the same order, with the same excerpts. It finds words by their beginnings, ignores case and accents, and allows a typo in long words, but it doesn't reduce words to their stems. The website downloads a language's whole index before its first search, a few hundred KB compressed for a site of about 60 long pages, so it suits sites of up to a few hundred pages.
- **Both** gives each its best, but for the same words the website and an app can find different pages, or show them in a different order.

An app that hasn't synced since the last publish searches the copy of the site it last downloaded, so it finds what the website found then.

## Indexing

Builds index a site only if one of its pages has a Search block. The block marks itself with a `data-goodfellow-search` attribute, and after the pages are written, the build looks for it:

- `goodfellow build` indexes the site in `dist/` itself, writing the index to `dist/pagefind/`.
- Next.js sites run `goodfellow-next finish out` after `next build`, as the Next.js starter's build script does. (`goodfellow-next index out` only writes the index.)
- [Full-stack Next.js sites](/docs/full-stack-nextjs) run `goodfellow-next finish --server` after `next build`, which indexes the pages Next.js rendered while building into `public/pagefind/`, where the site's server serves it.
- `goodfellow index <folder>` indexes any other built site.

Pagefind's index goes into `pagefind/`. MiniSearch's goes into `minisearch/` for the website: a file for each language and the search code, each named by its hash, such as `minisearch/assets/en.3f2a9c01b4d7e6f0.json`, and `minisearch/minisearch.js`, which names them. For apps, it goes into the [content API](/docs/content-api), as each language's `search` in the manifest. Files named by their hash change their name when they change, so the header rules builds write for Cloudflare Pages, Netlify, and Vercel let browsers keep them for a year, and apps download a language's index again only when it changes. `minisearch.js` keeps its name, so it isn't kept that long.

On a site in [several languages](/docs/languages), each page says its language on its `<html>`, and Pagefind and MiniSearch both keep each language's pages in an index of their own: the Search block on a Spanish page finds only Spanish pages. Pages that say no language, or one written differently, such as `en_US`, are searched together with the pages that say the same.

Pages mark their main content with Pagefind's `data-pagefind-body`, which MiniSearch's index reads too, so the header and footer, which are on every page, aren't indexed, and neither is "Page not found". Neither are pages whose settings choose **Leave this page out of it** under **The site's search** (`noSearch`), such as a staff page you'd rather visitors found only from its link. A collection's template can choose it for every item's page. Pages a [full-stack site](/docs/full-stack-nextjs#pages-for-members) keeps to its members are left out too. Search doesn't work in `goodfellow dev` or the editor's preview, since there's no index there; the box says so, in words the block's settings choose.

## Other search blocks

A block from a [block registry](/docs/block-registries), or a site's own block, can use the same index: render `data-goodfellow-search` on its outermost element, so builds index the site, and load Pagefind from `/pagefind/pagefind.js`, adding the site's base path with `withBase()`. Where the site searches with MiniSearch on the website (`webSearchEngine(searchEngine(settings))` is `minisearch`), load `/minisearch/minisearch.js` instead, and render `data-gf-search-engine="minisearch"` beside `data-goodfellow-search`: it answers as Pagefind's module does (`options()`, `destroy()`, and `debouncedSearch()`, whose results' `data()` gives `url`, `meta.title`, and `excerpt`). A block that marks the page without saying so is taken to load Pagefind, so builds keep writing Pagefind's index for it whatever the site chooses, and it goes on working. A native block reads `useNativeSite().searchIndex` and searches it with `siteSearch()` from `@goodfellow-cms/core/site-search`, as the built-in Search block does.

```tsx
import { SEARCH_ATTRIBUTE } from "@goodfellow-cms/core";

render: ({ className }) => <div className={className} {...{ [SEARCH_ATTRIBUTE]: "" }}><MySearch /></div>
```
