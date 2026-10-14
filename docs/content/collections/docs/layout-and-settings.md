---
version: 1
title: Header, footer and settings
description: Edit the site's header and footer, menus, name, logo, colors, fonts, contact details and custom CSS.
section: editors
order: 5
---

## Header and footer

**Header & Footer** opens the header and the footer in the same editor as pages. They appear on every page. Blocks such as **Menu**, **Site name and logo** and **Contact details** read the site's settings, so changing the logo or a menu changes them everywhere.

## Site Settings

**Site Settings** has several tabs, with a preview of the home page that shows changes as you type. Undo and Redo work across every tab.

- **General:** the site's name, its address, the title shown in browser tabs, a description for search engines, the logo, the icon, the image for link previews, whether links to other sites open in a new tab, the time zone events' times are in (see [Calendars and events](/docs/calendars#time-zone)), the contact details (address, phone number and email address) that the Contact details block shows, and where forms' answers go (see [Forms](/docs/forms#choose-a-form-service)). Links to the site's own pages always open in the same tab.
- **Colors & fonts:** colors, fonts and how rounded corners are. Fonts are chosen from a searchable list of Google Fonts, each shown in its own typeface.
- **Menus:** named lists of links, with submenus. The header's Menu block shows one of them.
- **Redirects:** old addresses that send visitors on to new ones (see [Redirects](#redirects)).
- **Custom CSS:** CSS for the whole site, including Tailwind's `@apply`, in a code editor that indents, closes brackets, suggests properties and values, and finds and replaces (Ctrl+F). Tab indents; press Escape, then Tab, to leave it. It shows in the editor at once. Give a block your own class in its "CSS classes" setting, then style that class here.
- **Code:** code that services such as Google Analytics or a site verification give you, added to every page: **In the page head** takes `<script>`, `<style>`, `<link>`, `<meta>` and `<noscript>` tags, and **At the end of the page** takes any HTML. The code never runs in the admin panel, so check it on the site once it's published. Only paste code you trust, since it can change anything on the site. On a Next.js site, inline scripts from the page head run at the start of the page rather than in its head, and none of the code runs again when visitors move between pages.

## Redirects

**Site Settings → Redirects** sends visitors from old addresses to new ones, such as a page that moved, or the pages of a website this one replaced. Each redirect has:

- **Old address:** an address on this site, such as `/about-us`. You can paste the old page's full address, such as `https://old.example.org/about-us/`, and only its path is kept. Addresses with a `?` in them, such as `/?page_id=5`, can't be redirected, since a site made of files can't tell them apart from the address before the `?`.
- **Send visitors to:** a page on this site, such as `/about` (the field suggests the site's pages), or another website's address, starting with `https://`.

**Change address** on the Pages screen adds a redirect from the page's old address, unless you untick **Keep … working**, and points redirects to the old address at the new one, so visitors never go through two.

When the site is built, each old address gets a small page that sends visitors on at once and tells search engines where the page is now. Search engines treat it as a permanent redirect. Hosts such as GitHub Pages can't send redirects themselves, so this works on every host. A page always wins: if a page has a redirect's old address, visitors see the page, and the Redirects tab says so.
