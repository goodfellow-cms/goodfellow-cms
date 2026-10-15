---
version: 1
title: Search
description: How the Search block works, how sites are indexed, and how other blocks can use the same index.
section: developers
order: 9
---

The **Search** block searches the whole site in the visitor's browser with [Pagefind](https://pagefind.app). The index is made when the site is built, so no search service, server or account is needed, and the index only loads when someone searches.

## Indexing

Builds index a site only if one of its pages has a Search block. The block marks itself with a `data-goodfellow-search` attribute, and after the pages are written, the build looks for it:

- `goodfellow build` indexes the site in `dist/` itself, writing the index to `dist/pagefind/`.
- Next.js sites run `goodfellow-next finish out` after `next build`, as the Next.js starter's build script does. (`goodfellow-next index out` only writes the index.)
- [Full-stack Next.js sites](/docs/full-stack-nextjs) run `goodfellow-next finish --server` after `next build`, which indexes the pages Next.js rendered while building into `public/pagefind/`, where the site's server serves it.
- `goodfellow index <folder>` indexes any other built site.

Pages mark their main content with Pagefind's `data-pagefind-body`, so the header and footer, which are on every page, aren't indexed, and neither is "Page not found". Search doesn't work in `goodfellow dev` or the editor's preview, since there's no index there; the box says so, in words the block's settings choose.

## Other search blocks

A block from a [block registry](/docs/block-registries), or a site's own block, can use the same index: render `data-goodfellow-search` on its outermost element, so builds index the site, and load Pagefind from `/pagefind/pagefind.js`, adding the site's base path with `withBase()`.

```tsx
import { SEARCH_ATTRIBUTE } from "@goodfellow-cms/core";

render: ({ className }) => <div className={className} {...{ [SEARCH_ATTRIBUTE]: "" }}><MySearch /></div>
```
