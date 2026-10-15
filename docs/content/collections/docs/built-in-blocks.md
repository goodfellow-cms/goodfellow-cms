---
version: 1
title: Built-in blocks
description: The blocks every Goodfellow site has, from sections and columns to code, search and collection navigation.
section: editors
order: 7
---

Every site has these blocks. Sites can also have [blocks from block registries](/docs/add-blocks) and blocks of their own.

| Block | What it's for |
|---|---|
| Section | A full-width band of the page with a background, centering its content |
| Columns | Equal-width columns that stack on phones |
| Row | Blocks side by side, such as a group of buttons |
| Space | Empty vertical space |
| Heading | A heading, from page title (H1) down to H4 |
| Text | Formatted text: paragraphs, lists, links |
| Button | A link styled as a button |
| Image | An image with an optional caption |
| Video | A video from the media library, YouTube, Vimeo or another site's player |
| Form | A form whose answers a form service emails to you, or a Google form (see [Forms](/docs/forms)) |
| Code | Code with syntax highlighting, an optional title and a copy button |
| Contact details | The address, phone number and email address from Site Settings |
| Menu | One of the site's menus, with dropdowns for submenus |
| Site name and logo | The site's logo and name, linking home |
| Search | A search box for the whole site, with results as you type |
| Dark mode switch | Lets visitors choose light or dark colors, on sites with dark mode |
| Collection navigation | Links to every item in a collection, grouped by one of its choice fields |
| Collection list | A collection's items as a list or cards, with a heading, on pages of their own and a page for each choice (see [Showing collections](/docs/showing-collections)) |
| Collection loop | Blocks you design, shown once for each of a collection's items |
| Calendar | Events coming up, or a month at a time, from a collection of events or another calendar (see [Calendars and events](/docs/calendars)) |
| Entry field | One of the item's fields, in a collection's page design only |
| Add to calendar | Links that add the item's event to visitors' calendars, in a page design only |
| Previous and next | Links to the items before and after this one, in a page design only |
| On this page | The headings of the item's Markdown text, in a page design only |

Blocks use the site's colors, fonts and corner rounding. Every block accepts extra CSS classes, which override the block's own styles: `py-4` on a Section replaces its default padding.

## Video

The Video block shows a video from one of four places, chosen in **Video from**:

- **The media library**: an MP4 or WebM video uploaded to the site, up to 25 MB, with an optional picture shown before it plays and captions as a WebVTT (`.vtt`) file. Uploaded videos are kept in the site's repository for good, even after they're replaced, so longer ones are better on YouTube or Vimeo.
- **YouTube**: paste the video's address in any form YouTube gives it (a `watch` address, a `youtu.be` link, a Short, a live stream, or the embed code), or just its ID. A start time in the address, such as `t=1m30s`, is kept. It plays in YouTube's privacy-enhanced player, which sets no cookies until it's played.
- **Vimeo**: paste the video's address, including an unlisted video's, or its embed code. It plays with Vimeo's "do not track" on.
- **Another site's player**: paste the player's embed address, or the whole embed code the other site gives. It's shown in a sandbox, with only what players need, and only from a secure (`https://`) address on another site.

Give every video a description for screen readers. It can also have a caption below it, a shape (the video's own, wide, landscape, square, or tall for videos made on phones), and play on its own without sound, start with the sound off, or play again when it ends. Players load only when they're scrolled near, so they don't slow down the top of the page.

## Code

The Code block highlights code when the site is built, so visitors' browsers don't have to. It knows Bash, CSS, diffs, HTML, JavaScript, JSON, JSX, Markdown, Python, TSX, TypeScript and YAML, in colors like the page's (light, or dark when the site's [dark mode](/docs/layout-and-settings#dark-mode) shows it dark), or always light or dark. Which colors those are is a site setting, [Code colors](/docs/layout-and-settings#code-colors). The copy button's label is the block's to set, so sites in other languages can translate it; leave it empty for no button.

## Dark mode switch

On a site with [dark mode](/docs/layout-and-settings#dark-mode), the Dark mode switch lets visitors choose light or dark colors instead of following their computer's setting. **Show as** chooses:

- **A switch between light and dark**, with a sun or a moon on it, and the words **Light** and **Dark** beside it if **Words beside the switch** is **Show**.
- **A menu**, like the admin panel's: **Light**, **Dark** or **Follow my computer**, which goes back to following the computer's setting.

The visitor's choice is kept in their browser and put back at the start of every page, before it shows, so pages never flash the other colors first. Every word is the block's to set, so sites in other languages can translate them. On a site without dark mode, the switch isn't shown, and the editor says where to turn dark mode on.

## Search

The Search block searches the whole site in the visitor's browser, with [Pagefind](https://pagefind.app), so no search service is needed. When a site has a Search block, its build makes a search index of every page's main content; headers, footers and "Page not found" are left out. Search only works on the built site, so in the editor the box says so. See [Search](/docs/search) for details.
