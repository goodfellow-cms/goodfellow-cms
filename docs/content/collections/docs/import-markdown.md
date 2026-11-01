---
version: 1
title: Import Markdown files
description: Bring a folder of Markdown files, such as another static site's content or notes, into a Goodfellow site as pages and collections, with their links, pictures and front matter.
section: owners
order: 6.1
---

A folder of Markdown files, such as the content of a site made with Hugo, Jekyll, Eleventy, Astro or Docusaurus, or notes kept as `.md` files, can be brought into a Goodfellow site. You choose which folders become pages and which become [collections](/docs/collections), and see what will come across before anything changes. To go the other way, see [Export as Markdown](/docs/export-markdown).

## In the admin panel

1. Go to **Site Settings → Import / Export**, and under **Import Markdown files**, choose the folder. Your browser may ask before letting the page read it.
2. Choose how each folder comes across: **Pages**, the choice for the files at the top, or **A collection**, the choice for every other folder.
3. Tick what else you'd like: replacing the home page with the top's `index.md`, replacing pages the site already has at the same addresses, importing drafts too, adding the top-level pages to the main menu, and keeping other front matter as fields.
4. Check what will come across: the pages, each collection with its items' addresses, the redirects and the media, and anything that couldn't come across as it was.
5. Click **Import**. Pictures are made ready as uploads are, then everything is published in one go. With drafts, everything goes into a [draft](/docs/publishing#drafts) instead, so nothing goes live until you publish it.

## Pages

Each file in a folder imported as pages becomes a page of built-in blocks, as [WordPress pages do](/docs/move-from-wordpress): headings, paragraphs, lists, quotes, tables, code and pictures.

- **Addresses:** `about.md` and `about/index.md` become `/about`, as do `_index.md` and `README.md` for their folder. A `permalink` or `url` in the front matter wins, and `slug` changes the last part.
- **The home page:** the top's `index.md` replaces it only when you tick **Replace the home page**.
- **Pages the site has:** a file at an address the site already has a page at is left out, unless you tick **Replace pages**. Version history keeps the old ones.
- **Settings:** `title` (or the first heading, or the file's name), `description`, `image` and `noindex` become the page's settings.
- **The main menu:** with **Add the top-level pages to the main menu**, they're added after what's there, in the order of their `weight`, `order`, `nav_order` or `sidebar_position`, and then by title.

## Collections

Each folder imported as a collection becomes one, named after the folder, with its items at `/<folder>/<name>`, or where their `permalink` puts them, when every item's agrees. Items keep their Markdown as written, as [Markdown items](/docs/content-files#markdown-items) do.

- **Fields:** `title`, `date` (or the date a Jekyll post's file name starts with), `description` or `summary`, `image`, `categories` and `tags` become fields, and the collection is sorted newest first where items have dates. Other front matter is left out, unless you tick **Keep other front matter as fields**, which keeps text and yes-or-no values.
- **The folder's own page:** a folder's `_index.md` or `index.md` becomes a page at the collection's address that lists its items; without one, a page listing them is made, unless the site has a page there already.
- **Names:** an item's name is its file's, without a date at its start, or its `slug`.
- **HTML** in items' Markdown shows as text, as it does in every Markdown item, and the import lists the items that have some.

## Links, pictures and addresses

- **Links between the files** get their new addresses, `#` parts included. Links to addresses the site already has stay; links to files or pages that aren't there become just their words, so nothing is broken, and the import lists where.
- **Pictures and files** next to the Markdown, or under `static/`, `public/` or `assets/` for addresses starting with `/`, are copied into the media library, each once. Ones that aren't there are left out and listed.
- **Redirects:** an address that changed, and every address in `aliases` or `redirect_from`, sends visitors to the new one. Files in folders starting with `_`, such as Jekyll's `_posts`, were never addresses of the old site, so they get none.
- **Drafts:** files with `draft: true` or `published: false` are left out unless you tick **Import drafts too**.
- **Template code** of another site, such as Hugo's shortcodes `{{< … >}}` or Liquid's `{% … %}`, shows as written, and the import lists the files that have some.

## From the command line

```sh
npx goodfellow import markdown ../old-site/content
```

(`npx goodfellow-next import markdown` for a Next.js site.) The files at the top become pages and every folder a collection, unless `--pages <folder>` or `--collection <folder>` says otherwise, once for each folder, with `.` for the files at the top. `--replace-home`, `--replace-pages`, `--drafts`, `--menu` and `--keep-fields` do what the boxes in the admin panel do. `--dry-run` says what would come across and changes nothing. SVG pictures aren't copied, since only the admin panel can make them safe, nor are files over 25 MB.
