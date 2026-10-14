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

- **Add a block** by dragging it from the list on the left onto the page. Blocks are grouped: layout, content, navigation, collections, and any [added to the site](/docs/add-blocks).
- **Change a block** by clicking it: its settings appear on the right. Text in headings and text blocks can also be typed straight onto the page.
- **Move a block** by dragging its handle, and remove it from its toolbar.
- **Undo and redo** with the buttons above the page, or Ctrl+Z and Ctrl+Shift+Z.
- **Light or dark:** the admin panel follows your computer's setting. To choose for yourself, use the menu at the top right; your browser remembers it.
- **CSS classes**: every block has a "CSS classes" setting for [Tailwind](https://tailwindcss.com) classes, such as `mt-8` or `text-center`, which override the block's own styles, and for classes of your own that [Custom CSS](/docs/layout-and-settings#site-settings) styles. Both show in the editor at once.

Nothing changes on the live site until you **Publish**.

## Create, move and delete pages

- **New page** asks for a title and suggests an address from it, such as `/mass-times` for "Mass Times". Addresses use lowercase letters, numbers and hyphens, and folders such as `/about/staff` are fine.
- **Change address** moves a page. It can update the menu links that point to it at the same time, and keeps the old address working with a [redirect](/docs/layout-and-settings#redirects).
- **Delete** removes a page. The home page can't be deleted.

## A page's settings

Click outside every block to see the page's own settings: its title (shown in the browser's tab and in search results), a description for search engines and link previews, and an image for link previews.
