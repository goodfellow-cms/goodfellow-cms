# Goodfellow's documentation site

These are Goodfellow's docs, built with Goodfellow itself. The pages are a collection of Markdown files in `content/collections/docs/`, one per page, shown with the collection's page design: navigation, the page's text, "On this page", and previous and next links. The home page and "Page not found" are ordinary pages in `content/pages/`.

## Editing

Edit the Markdown files directly, or in the admin panel:

```sh
pnpm install && pnpm build   # from the repository's root
cd docs
pnpm dev                     # site at http://localhost:4321, admin panel at /admin
```

Each file starts with its front matter: `title`, a `description` shown under the title and in search results, its `section` (`start`, `editors`, `owners` or `developers`) and its `order` within the section. Links between pages are root-relative, such as `/docs/create-a-site`, and headings can be linked to as `/docs/create-a-site#try-it-on-your-computer`. A test checks that every link and heading link goes somewhere.

Keep files in the form the admin panel writes them: after editing one by hand, `pnpm test` in `packages/cli` says if it isn't.

When a change to Goodfellow changes what users see or do, update these pages in the same change.

## Building

`pnpm build` writes the site to `dist/`, with a search index, since the header has a Search block. `pnpm preview` serves it.

Both `pnpm dev` and `pnpm build` first run `scripts/starters.mjs`, which packs the starters for the [setup page](content/pages/new-site.json) into `public/starters/`. Locally they have no `package-lock.json` files, so the page warns that sites it creates won't build; the published site has them (see `.github/workflows/docs.yml`). To try creating a site for real, set `GOODFELLOW_STARTER_LOCKFILES=1`, which needs the packages' versions to be on npm.

`scripts/demo.mjs` builds [the demo](https://goodfellow-cms.github.io/goodfellow-cms/demo/admin/), which `docs.yml` publishes at `/demo/` beside the docs: the parish example as create-goodfellow makes it, with the recommended blocks and the Gutenberg plugin, in demo mode, from the packages on npm. Try it with `node scripts/demo.mjs /demo/ dist/demo` after `pnpm build`.

## Online

The site is at <https://goodfellow-cms.github.io/goodfellow-cms/>, published with GitHub Pages by `.github/workflows/docs.yml`. It describes the latest release: the release workflow deploys it after publishing a new version to npm, from that version's commit, so changes to these pages go online with the next release. To publish a fix sooner, run **Deploy docs** in the repository's Actions tab with `master` as the version. See [RELEASING.md](../RELEASING.md).

It has no admin panel online, since the backends can't yet edit a site in a subfolder of a repository; edit it on your computer as above.
