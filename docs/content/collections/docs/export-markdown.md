---
version: 1
title: Export as Markdown
description: Download a site's pages and collection items as Markdown files, with its media, for other website tools such as Hugo, Jekyll, Eleventy and Astro, notes apps and AI tools, and what doesn't come across.
section: owners
order: 6.2
---

A site's pages and [collection](/docs/collections) items can be downloaded as a folder of Markdown files, with the media library, to use with another website tool such as Hugo, Jekyll, Eleventy or Astro, a notes app such as Obsidian, or an AI tool. It's the opposite of [importing Markdown files](/docs/import-markdown), which reads what it writes back.

Markdown holds words and pictures, not a site's look, so the export leaves out a good deal (see [What doesn't come across](#what-doesnt-come-across)). To keep everything, to put back later or to move into another Goodfellow site, use **Download a copy** on **Site Settings → Site history** instead (see [Downloading a copy](/docs/publishing#downloading-a-copy) and [Move content between Goodfellow sites](/docs/move-between-sites)).

## In the admin panel

1. Go to **Site Settings → Import**, and find **Export as Markdown**.
2. Choose how links between pages are written:
   - **As the site's addresses**, such as `/about/`, for website tools, which serve each file at its address. This is the default.
   - **As links to the files**, such as `about.md`, for notes apps, which follow links between files.
3. Tick **Also export pages and items that aren't shown yet or anymore** to include what a [schedule](/docs/scheduling) hides now, marked as drafts. Without it, they're left out.
4. Click **Download the Markdown files**. You get one zip file named after the site, and a list of anything that couldn't come across as it was.

## What it writes

```
my-site-markdown/
  index.md               the home page
  about.md               /about
  news/
    index.md             /news, with the items under it
    fall-fair.md         /news/fall-fair
  es/…                   each other language's pages, under its code
  _staff/…               a collection without pages of its own
  media/…                the media library
  menus.json             the menus
```

- **Each page and item** is a file at its address: `about.md` for `/about`, or `about/index.md` where other pages are under it. The home page is `index.md`.
- **Front matter** says what the page is: `title`, `description`, `permalink` (its address), `aliases` and `redirect_from` (old addresses that [redirect](/docs/layout-and-settings#redirects) to it), `lang` (its language, where it isn't the main one), `translationKey` (shared by a page and its [translations](/docs/languages)), `noindex` and `image` (its search engine settings), and for scheduled pages, `publishDate`, `expiryDate` and `draft`.
- **Pages' blocks** become Markdown: headings, paragraphs, lists, quotes, links, pictures with their descriptions as alt text, tables, code, buttons as links, and what's in sections, columns and collapsible blocks, one after another.
- **Items' fields** are front matter, by their names, with the item's date as `date`. The body is the item's text: [Markdown items](/docs/content-files#markdown-items) keep theirs as written, and rich text becomes Markdown.
- **Links** to the site's own pages and media keep the site's addresses, ending as its addresses do, unless you chose links to the files.

## Using it with other tools

- **Jekyll, Eleventy and Astro** read the folder as it is: put the Markdown files where the tool keeps its pages, and `media/` where it keeps files served as they are (Jekyll's site folder, Eleventy's passthrough copy, Astro's `public/`).
- **Hugo** reads `index.md` in a folder as a page whose other files are its pictures, so rename each folder's `index.md` to `_index.md` there, and put `media/` in `static/`.
- **Obsidian and other notes apps:** choose links to the files.

## What doesn't come across

- **The site's look:** its layout, colors and fonts, and blocks' Style settings. What sections and columns hold comes out one after another.
- **The header and footer**, which Markdown has no place for. The menus come across, as `menus.json`.
- **Blocks that do something or show other content:** forms, newsletter signups, search, calendars, lists of items, the On this page list, breadcrumbs, menus, share buttons, page lists and the dark mode switch. The download lists each, and the pages it was left out of.
- **Blocks of the site's own** and blocks added from block registries: only what's in their slots comes across, since the export reads the site's content, not its code.
- **Videos and posts from other sites** become links. Focal points and crops of pictures are left out.
- **Collections' page designs:** each item is its fields and its text.
- **Settings:** forms, consent, visit counts, custom code and CSS, plugins and editors' limits.
- **Media your storage service keeps**, which isn't downloaded: pages link to it where it's kept.

Importing the files again doesn't give back the same site: pages come back as built-in blocks, not the layout they had.

## From the command line

```sh
npx goodfellow export markdown
```

(`npx goodfellow-next export markdown` for a Next.js site.) It writes a folder named after the site, or the folder you name, which has to be empty or not exist yet. `--scheduled` exports what a schedule hides now, as drafts, and `--links files` writes links to the files.
