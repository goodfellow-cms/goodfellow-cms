---
version: 1
title: Header, footer and settings
description: Edit the site's header and footer, menus, name, logo, colors, fonts, contact details and custom CSS.
section: editors
order: 5
---

## Header and footer

**Header & Footer** opens the header and the footer in the same editor as pages. They appear on every page. Blocks such as **Menu**, **Site name and logo** and **Contact details** read the site's settings, so changing the logo or a menu changes them everywhere. On a site in [several languages](/docs/languages#the-header-and-footer), each language can have a header and footer of its own.

## Site Settings

**Site Settings** has several tabs, with a preview of the home page that shows changes as you type. Undo and Redo work across every tab.

- **General:** the site's name, its address, the title shown in browser tabs, a description for search engines, the logo, the icon, the image for link previews, whether links to other sites open in a new tab, the time zone events' times are in (see [Calendars and events](/docs/calendars#time-zone)), the contact details (address, phone number and email address) that the Contact details block shows, and where forms' answers go (see [Forms](/docs/forms#choose-a-form-service)). Links to the site's own pages always open in the same tab.
- **Languages:** the site's main language and any others, each with the site's name and description in it (see [Several languages](/docs/languages)).
- **Colors & fonts:** colors, fonts and how rounded corners are, and dark mode (see [Dark mode](#dark-mode)). Fonts are chosen from a searchable list of Google Fonts, each shown in its own typeface. While a font loads, or if it can't, pages show one of the computer's own fonts of the same kind, such as a serif for a serif font, resized to take the same space, so the text doesn't move when the font arrives.
- **Menus:** named lists of links, with submenus. The header's Menu block shows one of them. On a site in several languages, each language can have menus of its own.
- **Redirects:** old addresses that send visitors on to new ones (see [Redirects](#redirects)).
- **Custom CSS:** CSS for the whole site, including Tailwind's `@apply`, in a code editor that indents, closes brackets, suggests properties and values, and finds and replaces (Ctrl+F). Tab indents; press Escape, then Tab, to leave it. It shows in the editor at once. Give a block your own class in its "CSS classes" setting, then style that class here.
- **Code:** code that services such as Google Analytics or a site verification give you, added to every page: **In the page head** takes `<script>`, `<style>`, `<link>`, `<meta>` and `<noscript>` tags, and **At the end of the page** takes any HTML. The code never runs in the admin panel, so check it on the site once it's published. Only paste code you trust, since it can change anything on the site. On a Next.js site, inline scripts from the page head run at the start of the page rather than in its head, and none of the code runs again when visitors move between pages.

## Dark mode

A site is light only until you turn on dark mode, under **Colors & fonts → Dark mode**: **Follow each visitor's light or dark setting**. Then visitors whose computer or phone is set to dark see the site in its dark colors, and everyone else sees it as before.

- **Colors in dark mode:** each of the site's colors has a dark one. Colors you leave empty use the defaults shown, neutral grays with white text. Choose dark colors that suit your main color: a dark blue that works as the main color on white is hard to see on a dark background, so a lighter blue usually works better.
- **Preview:** choose **Light** or **Dark** to see the preview either way. Until you choose, the preview is light or dark like the admin panel.
- **Logo in dark mode:** on the **General** tab, a version of the logo for dark backgrounds, such as a white one. Without one, the same logo is shown in both.
- **Code** in Code blocks set to **Like the page**, and code in Markdown items, changes to its dark colors too (see [Code colors](#code-colors)).
- **Choosing:** the [Dark mode switch](/docs/built-in-blocks#dark-mode-switch) block lets visitors choose light or dark for themselves, such as in the header. Without one, the site follows each visitor's setting.

Turning dark mode off keeps the dark colors, so turning it back on finds them again.

## Colors and contrast

Text needs to stand out from what's behind it, for people who don't see well, on phones in sunlight, and for search engines, which notice. While you choose colors, **Colors & fonts** says which of them make text hard to read: text on the background, muted text on the background and on the subtle background, and each color's text on that color, such as button text on the main color, in dark mode too. It measures them as the Web Content Accessibility Guidelines do, which ask for a contrast of at least 4.5 to 1. Publishing lists them too, and you can [publish anyway](/docs/publishing#site-checks).

## Code colors

**Colors & fonts → Code colors** chooses how code in Code blocks and Markdown items is colored, from color schemes made for code, such as GitHub's, Everforest or Rosé Pine:

- **Light colors** are for code that looks like the page, and for Code blocks set to **Light**.
- **Dark colors** are for code that looks like the page in [dark mode](#dark-mode), and for Code blocks set to **Dark**.
- **Show code on the subtle background color** gives code that looks like the page the site's **Subtle background** color, instead of the background its colors were made for, so it matches the rest of the site. Some colors are harder to read on another background, so check how the code looks.

GitHub Light and GitHub Dark are the defaults.

## Redirects

**Site Settings → Redirects** sends visitors from old addresses to new ones, such as a page that moved, or the pages of a website this one replaced. Each redirect has:

- **Old address:** an address on this site, such as `/about-us`. You can paste the old page's full address, such as `https://old.example.org/about-us/`, and only its path is kept. Addresses with a `?` in them, such as `/?page_id=5`, can't be redirected, since a site made of files can't tell them apart from the address before the `?`.
- **Send visitors to:** a page on this site, such as `/about` (the field suggests the site's pages), or another website's address, starting with `https://`.

**Change address** on the Pages screen adds a redirect from the page's old address, unless you untick **Keep … working**, and points redirects to the old address at the new one, so visitors never go through two.

On **Vercel**, Vercel sends the redirects itself, as permanent redirects, so visitors go straight to the new address: the site's `vercel.ts` gives them to Vercel, or, on a Next.js site, `withGoodfellow()` in `next.config.ts` does. (`next build` then warns that redirects don't work with a static export, which is true of other hosts, and why they get the pages below instead.)

Hosts such as GitHub Pages and GitLab Pages can't send redirects themselves, so when the site is built, each old address gets a small page that sends visitors on at once and tells search engines where the page is now. Search engines treat it as a permanent redirect, and Back skips it. For the moment it shows, or for good in browsers without JavaScript, it says **This page has moved to** and links to the page. **Message while visitors are sent on** changes the wording, such as to the site's own language; `{page}` in it becomes the link.

A page always wins: if a page or a collection's item has a redirect's old address, visitors see the page, and the Redirects tab says so.
