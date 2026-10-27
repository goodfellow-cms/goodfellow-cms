---
version: 1
title: Edit pages
description: Create, edit, move and delete pages in the admin panel's visual editor.
section: editors
order: 1
---

Open `/admin` on the site and sign in. The **Pages** screen lists every page with its address.

## Edit a page

Click **Edit** beside a page. The editor shows the page with the site's own header, footer, colors and fonts, exactly as visitors will see it.

- **Add a block** by dragging it from the list on the left onto the page. Blocks are grouped: layout, text, buttons and forms, media, navigation, collections, and any [added to the site](/docs/add-blocks). The groups that fit what you're editing start open, such as navigation in the header and footer, and the rest open with a click. To find a block without looking through the groups, type in **Search blocks** at the top of the list: it finds blocks by their names and by other words for them, such as "divider", "columns" or "picture", and WordPress's names for its blocks, such as "Cover". Drag a block from what it finds as from the list; Escape shows the groups again.
- **Change a block** by clicking it: its settings appear on the right. Text in headings and text blocks can also be typed straight onto the page.
- **Move a block** by dragging its handle, and remove it from its toolbar.
- **Undo and redo** with the buttons above the page, or Ctrl+Z and Ctrl+Shift+Z.
- **Phones and tablets:** **Tablet** and **Phone** above the page show it as wide as one, and **Full width** goes back.
- **Another editor:** where the site has a [plugin with a page editor of its own](/docs/plugins#a-page-editor-of-its-own), **Editor** above the page chooses it or the standard editor, and your browser remembers your choice. What you've changed so far comes with you when you switch.
- **Light or dark:** the admin panel follows your computer's setting. To choose for yourself, use the menu at the top right; your browser remembers it.
- **CSS classes**: every block has a "CSS classes" setting for [Tailwind](https://tailwindcss.com) classes, such as `mt-8` or `text-center`, which override the block's own styles, and for classes of your own that [Custom CSS](/docs/layout-and-settings#site-settings) styles. Both show in the editor at once.

Nothing changes on the live site until you **Publish**.

## Create, move and delete pages

- **New page** asks for a title and suggests an address from it, such as `/mass-times` for "Mass Times". Addresses use lowercase letters, numbers and hyphens, and folders such as `/about/staff` are fine.
- **Duplicate** makes a new page from a copy of one that's already there, with the same blocks and settings, so a page much like another needn't start from scratch. It suggests the title with "(copy)" after it, and an address beside the page it copies, which you can change. The copy is shown on the site at once, even if the page it copies is scheduled, and it isn't a translation of anything.
- **Change address** moves a page. Every link to it on the site, in menus, buttons, text and items alike, changes to the new address in the same publish, and a [redirect](/docs/layout-and-settings#redirects) keeps the old address working for links from other websites.
- **Delete** removes a page. The home page can't be deleted, and a page other pages or menus link to can't be deleted until those links are changed (see [Site checks](/docs/publishing#site-checks)).

## A page's settings

Click outside every block to see the page's own settings: its title (shown in the browser's tab and in search results), a description for search engines and link previews, an image for link previews, and whether search engines show it, with a preview of how links to it look when shared (see [Search engines and feeds](/docs/search-engines)).
