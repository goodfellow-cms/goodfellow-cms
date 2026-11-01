---
version: 1
title: Move from WordPress
description: Bring a WordPress site's pages, posts, categories, tags, menus and media into a Goodfellow site, from its export file or its address, or move a Goodfellow site to WordPress.
section: owners
order: 6
---

A WordPress site can be brought into a Goodfellow site: its pages, posts, categories, tags, menus and media, with WordPress's blocks turned into Goodfellow's and old addresses kept or sent on to the new ones. You can do it in the admin panel, or from the command line, which also copies the media.

Nothing changes on the WordPress site, and you can keep it running until the new site is ready. A site kept as Markdown files, such as one made with Hugo or Jekyll, comes across with [Import Markdown files](/docs/import-markdown) instead.

## Where to import from

- **An export file**, which brings the most. In WordPress, go to **Tools → Export**, choose **All content** and click **Download Export File**. It has every page and post, their categories and tags, and the menus.
- **The site's address**, such as `example.org`. Goodfellow reads what the site shows its visitors through WordPress's API, so it brings published pages and posts, but not menus, which WordPress only shows to people who are signed in.

## In the admin panel

1. Go to **Site Settings → Import / Export**.
2. Choose the export file, or type the site's address and click **Read the site**.
3. Check what will come across: how many pages and posts, where the posts will be, which of the site's pages will be replaced, and anything that couldn't come across as it was.
4. Click **Import**. Goodfellow copies the media, then publishes everything in one go.

Most WordPress sites don't let other websites download their files, and a browser can only copy media from those that do. Media that can't be copied stays where it is: pages show it from the WordPress site, and the import lists it, so you can upload it on the [Media screen](/docs/media) before you turn the WordPress site off. Importing from the command line copies every file.

On a [full-stack Next.js site](/docs/full-stack-nextjs), only owners can import, since an import changes Site Settings and menus too.

## From the command line

In the site's folder:

```sh
npx goodfellow import wordpress wordpress-export.xml
npx goodfellow import wordpress example.org
```

A Next.js site uses `npx goodfellow-next import wordpress` the same way. Either writes the files into `content/` and `public/media/`, which you then publish by committing them. `--dry-run` says what would come across and changes nothing.

A new site can start from a WordPress site straight away:

```sh
npm create goodfellow@latest my-site -- --wordpress wordpress-export.xml
```

From the command line, JPEG photos lose the details hidden in them, such as where they were taken, as uploads in the admin panel do, unless those details are what turn the photo the right way up. SVG images aren't copied, since only the admin panel can check them for anything that could run code; upload them on the Media screen. Files over 25 MB, the upload limit, aren't copied either.

## What comes across

- **Pages** keep their addresses, such as `/about/staff`, with their titles as their headings. A page at an address Goodfellow uses itself, such as `/admin`, gets one of its own.
- **WordPress's blocks** become Goodfellow's [built-in ones](/docs/built-in-blocks): headings, text with its lists, quotes, links and formatting, images with their captions and descriptions, galleries, columns, buttons, YouTube and Vimeo videos and video files, sound files, files with their download buttons, code, preformatted text and verse, pullquotes, tables with their cells' links and formatting, details, separators, media and text, page lists, spacers, and covers as sections with their picture behind them, with the cover's color over it, its height and its focal point. Synced patterns (reusable blocks) that pages use become [synced blocks](/docs/synced-blocks), which the pages place, so changing one still changes every page; in posts, and inside another synced pattern, their blocks are put in place. Classic pages, written before WordPress had blocks, come across too, with their captions and galleries.
- **Posts** become a collection of [Markdown items](/docs/collections), with their dates, featured images, summaries, categories and tags. Where WordPress's addresses for them can stay as they are, such as `/my-post` or `/blog/my-post`, they do; addresses with dates in them, such as `/2026/06/my-post`, can't be a collection's addresses, so posts move to `/news/my-post` (or `/posts/` where the site already uses `/news/`), and their old addresses send visitors on.
- **The list of posts** goes on WordPress's own page for posts, such as `/news`. Without one, it goes where the posts' addresses start, such as `/blog`, or on the home page. It has a page for each category, and WordPress's category and tag archives, such as `/category/events`, send visitors there.
- **Scheduled posts** stay [scheduled](/docs/scheduling), and appear when WordPress would have published them.
- **Menus** become the site's menus: the main menu (the one named like "Primary" or "Main", or else the longest), the footer's, and others by name. Menus go two levels deep, so deeper items join their top-level item's list. Without menus, such as from a site's address, the main menu lists the top-level pages.
- **The site's name and tagline** become its title and description in Site Settings.
- **Media** that the pages and posts use is copied into the media library, once, whatever size of it they showed. Files that nothing uses aren't copied. Images' alt text in WordPress's media library becomes their [description](/docs/media#file-details), which images use wherever a block leaves theirs empty.
- **Links** to the WordPress site's pages and posts get their new addresses. Links to anything that wasn't imported, such as a draft, still go to the WordPress site, and the import lists them.

## What doesn't come across

- **Drafts, private pages and posts, and the trash.**
- **Comments**, which stay in WordPress. New comments can go on GitHub with the [Comments](/docs/comments) block.
- **Other kinds of content**, such as products or events from a plugin. The import names them.
- **What plugins do.** Shortcodes, such as a contact form's, only work in WordPress, so they're left out, and the import lists the pages they were on, so you can put a [Form block](/docs/forms) where a form was. Blocks from other plugins come across as their text and pictures.
- **Videos in posts**, which become links to them, since Markdown shows videos as links.
- **The theme.** The site keeps its own [colors, fonts and layout](/docs/layout-and-settings).

## After importing

Check the pages the import lists, then:

1. Upload any media it couldn't copy, and add descriptions to images that have none.
2. Put a Form block wherever a form was left out.
3. Set the site's address in **Site Settings → General**, then [point the domain](/docs/custom-domains) at the new site. The redirects keep old links working.
4. Keep the WordPress site until you're happy with the new one.

Importing again brings the site across again, replacing the pages and posts at the same addresses, and copies its media again, as new files. Version history keeps everything it replaced.

## Moving to WordPress

A Goodfellow site can go to WordPress too, as a WordPress export file, so choosing Goodfellow never locks a site in. The export is also a copy of the site that any WordPress site can read.

1. Set the site's address in **Site Settings → General**, if it hasn't one, since WordPress copies the media from it.
2. Go to **Site Settings → Import / Export** and click **Download the export file**, or run `npx goodfellow export wordpress` in the site's folder (`npx goodfellow-next export wordpress` for a Next.js site), which writes a file named after the site, or the file you name after it.
3. In WordPress, go to **Tools → Import → WordPress**, install the importer if it asks, and choose the file.
4. Tick **Download and import file attachments**, which copies the media library from the Goodfellow site, and click **Submit**.

What goes across:

- **Pages** keep their addresses, such as `/about/staff`, with their place under other pages. The home page is a page called "home", which you can make WordPress's home page in **Settings → Reading**.
- **Blocks** become WordPress's own: headings, text with its lists and links, images with their captions, galleries, buttons, columns and rows, sections with a picture behind them as covers, with their color over it, height and focal point, YouTube and Vimeo videos and video files, sound files, files, code, preformatted text and verse, pullquotes, tables, details, separators, media and text, page lists, spaces, contact details as text, and collection lists as a list of the latest posts. A page's first heading is left out when it's the page's title, since WordPress's themes show the title. [Synced blocks](/docs/synced-blocks) become synced patterns, which the pages place, in the main language.
- **Items of collections with pages** become posts, with their dates, summaries, first images as featured images and text, each collection a category and its tags and choices as tags. [Scheduled](/docs/scheduling) items stay scheduled, and ones their schedule has hidden again become drafts.
- **Menus** go across with their links, which point at the pages and posts they went to.
- **Media**: every file in the media library, which WordPress copies from the site's address, with images' [descriptions](/docs/media#file-details) as their alt text.

What doesn't:

- **Blocks WordPress has nothing like**, such as forms, calendars, search and the dark mode switch. The export lists the pages they were on, so you can use a plugin in their place.
- **Collections without pages of their own**, such as a list of staff, since WordPress's posts each have a page.
- **The header and footer, and the theme.** WordPress's theme shows its own, with the menus.
- **Redirects**, which WordPress needs a plugin for. The export says how many there are, and they're in `content/redirects.json`.
- **Blocks from block registries**, apart from what's in their slots.
