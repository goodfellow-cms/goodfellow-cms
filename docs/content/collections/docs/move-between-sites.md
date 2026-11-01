---
version: 1
title: Move content between Goodfellow sites
description: Export a Goodfellow site's pages, collections, synced blocks, menus, settings and media as one file, and import it into another Goodfellow site, adding to its content or replacing it, with nothing lost.
section: owners
order: 6.3
---

A Goodfellow site's content can be moved into another Goodfellow site as it is: pages keep their blocks and layout, collections keep their fields and design, and synced blocks, menus, settings and media come across too. It's for starting a new site from an old one, bringing two sites together, or copying a section from one site to another. Unlike [Move from WordPress](/docs/move-from-wordpress) or [Export as Markdown](/docs/export-markdown), nothing is converted, so nothing is lost that the other site can show.

## Exporting

On **Site Settings → Import**, **Export for another Goodfellow site** downloads one zip file named after the site and the day, such as `st-anne-2026-11-01.zip`. It's the same file **Download a copy** on **Site Settings → Site history** makes (see [Downloading a copy](/docs/publishing#downloading-a-copy)): everything in `content/`, the media library, the lists of blocks and plugins the site added, and `goodfellow-transfer.json`, which says which release of Goodfellow made it and which blocks its pages use. A copy downloaded before that file was added imports too.

Media kept in a [storage service](/docs/media#media-kept-in-a-storage-service) isn't in the file: the other site's pages link to where it's kept, or list it in their own storage where both sites use the same one.

## Importing

1. On the other site, go to **Site Settings → Import**, and find **Import from another Goodfellow site**.
2. Choose the zip file. Nothing changes yet: you see what it brings in first.
3. Choose how to bring it in:
   - **Add to this site** (the default) keeps this site's content and brings in the pages, collection items, synced blocks and media it doesn't have. Tick **Menus**, **Site Settings** (with colors and fonts, custom CSS and code, and the admin panel's languages), **The header and footer**, or **Redirects** to bring those in too. Menus are merged by name, and only redirects this site doesn't have are added.
   - **Replace this site's content** makes this site's content the other site's, and removes everything it doesn't have.
4. Where both sites have something, differently, such as a page at the same address, a collection item with the same name, or a media file with the same name, it's listed under **Both sites have these, differently**. This site's version is kept unless you tick **Use the other site's**, one by one or for all.
5. Click **Import**. It's published in one go, after the usual [site checks](/docs/publishing#site-checks). If it isn't what you wanted, go back on **Site Settings → Site history**.

## What always stays

Whichever way you import, these stay as the receiving site has them:

- **The Site address**, since signing in depends on it.
- **[Editors' limits](/docs/sign-in#limiting-what-editors-can-change)**, which name the other site's people.
- **[Update settings](/docs/updates)**, which are about the site's code.
- **Which [storage service](/docs/media#media-kept-in-a-storage-service) keeps its media.**

## Blocks and collections

- **Blocks the site doesn't have:** pages and the rest that use one of the other site's own blocks, or a block it added from a block registry that this site hasn't, are left out, and the list says which. Tick **Bring in what uses blocks this site doesn't have, without those blocks** to bring them in anyway, missing those blocks. Blocks the other site added from Goodfellow's block registry can be added in the same publish: tick **Add … from Goodfellow's block registry**, and the editor offers them once the site has been rebuilt. Blocks from other registries are only listed: add them under **Blocks** first. Sites whose code is kept apart from their content, demos and full-stack Next.js sites can't add blocks here.
- **Collections:** a collection this site doesn't have comes in whole. One it has with the same fields gets the other site's items added. One it has with other fields is listed under **Both sites have these, differently**: this site's collection is kept, with only the other site's items that fit it, unless you choose the other site's, which replaces this site's collection and its items.
- **Addresses:** a new page at an address one of this site's collection items has, or the other way round, is left out.
- **Plugins** aren't installed, only listed: add them under **Plugins**.

## Limits

- **Newer releases:** a file from a newer release of Goodfellow than this site's is refused until this site is [updated](/docs/updates). Older ones are brought up to date as they're read.
- **Large files:** the admin panel publishes everything at once. Media files over 25 MB, and files the media library doesn't take, are left out, as with uploads; very large sites may be slow to publish, or hit the host's limits. The command line has neither limit.
- **Custom code** comes in with **Site Settings** or **Replace this site's content**, and the list says so, since it runs on every page.
- **Who can:** importing changes Site Settings, so it's for owners. On a [full-stack Next.js site](/docs/full-stack-nextjs), the server refuses an editor's import of settings.

## From the command line

```sh
npx goodfellow export site
npx goodfellow import site st-anne-2026-11-01.zip
```

(`npx goodfellow-next export site` and `npx goodfellow-next import site` for a Next.js site.) `export site` writes the zip, named after the site, or the file you name, which has to be new. `import site` takes the zip, or the folder it unpacks to, and writes the changes into the site's folder, to publish with git. It keeps this site's version of what both have differently unless `--take export`; `--menus`, `--settings`, `--layout` and `--redirects` bring those in too, `--replace` replaces the site's content, `--without-missing-blocks` brings in what uses blocks the site lacks without them, and `--dry-run` says what would come across and changes nothing. It lists blocks to add from Goodfellow's block registry, which you add under **Blocks**.
