---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
---

A collection's items can come from another system, such as the site's database, while its fields, page design, and address stay in the admin panel. The config's new `collections` names each collection's source, a module whose default export reads its items (`defineCollectionSource()` in `@goodfellow-cms/core`), with options it's given: `collections: { jobs: { source: "./lib/jobs.ts", options: { table: "jobs" } } }`. Items are checked as items' files are, and one that doesn't fit is left out with a warning, so a bad row never stops the site. `goodfellow build`, `goodfellow dev`, and `goodfellow-next finish` load the modules themselves; Next.js sites pass them to `goodfellowPages()` and `goodfellowApi()` as `sources`, since Next.js bundles only what's imported. Pages, feeds, calendars, the content API, and the site checks show the source's items as the collection's (`withSourcedCollections()`), and `sourceChanges()` says which pages to render again when a source's `changed()` reports changes. The admin panel shows them read-only, from a full-stack site's server (`/api/goodfellow/collections/<id>/items`), counts their pages in its publish checks, and names the source in the collection's settings. The site's description names each source's module, never its options.
