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

**Site Settings** lists its tabs in a sidebar on the left, each with an icon; **Hide names** at the bottom of it shows only the icons, with each name appearing as you point at its icon, and the admin panel remembers the choice on that computer. In a narrow window, the sidebar shows only the icons. The first seven tabs are published together, with a preview of the home page that shows changes as you type, and Undo and Redo work across all of them:

- **General:** the site's name, its address, the title shown in browser tabs, a description for search engines, the logo, the icon, the image for link previews, whether links to other sites open in a new tab, the time zone events' times are in (see [Calendars and events](/docs/calendars#time-zone)), the contact details (address, phone number and email address) that the Contact details block shows, where forms' answers go (see [Forms](/docs/forms#choose-a-form-service)), and whether pages ask visitors before showing content from other sites (see [Visitors' consent](#visitors-consent)). Links to the site's own pages always open in the same tab.
- **Languages:** the site's main language and any others, each with the site's name and description in it (see [Several languages](/docs/languages)).
- **Colors & fonts:** colors, fonts and how rounded corners are, dark mode (see [Dark mode](#dark-mode)), and classes for blocks' parts (see [Blocks' parts](#blocks-parts)). A [theme](/docs/themes) sets these for you, and you can still change them here. Fonts are chosen from a searchable list of Google Fonts, each shown in its own typeface. Builds copy them into the site, so visitors' browsers load them from the site and never ask Google; if Google can't be reached when the site is built, its pages load them from Google until the next build. [Full-stack Next.js sites](/docs/full-stack-nextjs) do the same, copying them before their pages are drawn. While a font loads, or if it can't, pages show one of the computer's own fonts of the same kind, such as a serif for a serif font, resized to take the same space, so the text doesn't move when the font arrives.
- **Menus:** named lists of links, with submenus. The header's Menu block shows one of them. On a site in several languages, each language can have menus of its own.
- **Redirects:** old addresses that send visitors on to new ones (see [Redirects](#redirects)).
- **Custom CSS:** CSS for the whole site, including Tailwind's `@apply`, in a code editor that indents, closes brackets, suggests properties and values, and finds and replaces (Ctrl+F). Tab indents; press Escape, then Tab, to leave it. It shows in the editor at once. Give a block your own class in its **Style** setting's **Other CSS classes**, then style that class here, or style a part of every block of a kind by its name, such as `.gf-card-title` (see [Blocks' parts](#blocks-parts)).
- **Code:** code that services such as Google Analytics or a site verification give you, added to every page: **In the page head** takes `<script>`, `<style>`, `<link>`, `<meta>` and `<noscript>` tags, and **At the end of the page** takes any HTML. The code never runs in the admin panel, so check it on the site once it's published. Only paste code you trust, since it can change anything on the site. On a Next.js site, inline scripts from the page head run at the start of the page rather than in its head, and none of the code runs again when visitors move between pages.

Below them, after a line, the sidebar's other tabs are screens of their own: [Domain](/docs/custom-domains), [Editors](/docs/sign-in), [Themes](/docs/themes), [Updates](/docs/updates), [Site history](/docs/publishing#restoring-the-whole-site), [WordPress](/docs/move-from-wordpress) and [Security](/docs/security).

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

## Blocks' parts

Every part of a block has a name, such as `gf-heading` for a Heading or `gf-card-title` for the title of each card a Collection list shows, which [Built-in blocks](/docs/built-in-blocks#named-parts) lists. **Colors & fonts → Blocks' parts** gives a part classes for every block of that kind at once: choose a block, then type classes for any of its parts, such as `tracking-tight` for Headings or `rounded-xl shadow-sm` for cards. The preview shows them as you type, and the block menu says how many of each block's parts have classes.

- **Which classes win:** a part's classes come after the block's own, so `rounded-xl` replaces a card's `rounded-lg`, and before what's chosen for each block, such as its alignment and its **Style**, so a choice made for one block still wins.
- **Which classes work:** Tailwind's, as in a block's **Other CSS classes**, and your own from **Custom CSS**, where you can also style a part by its name, such as `.gf-card-title { … }`.
- **Shared parts:** some parts appear in more than one block, such as the page links under a Collection list and a Collection loop, and their classes apply in each.
- **Blocks from registries** name their parts after themselves, such as `gf-shadcn-cards-title`, and blocks of a site's own can have named parts too (see [Write your own blocks](/docs/write-blocks#rules)).

## Code colors

**Colors & fonts → Code colors** chooses how code in Code blocks and Markdown items is colored, from color schemes made for code, such as GitHub's, Everforest or Rosé Pine:

- **Light colors** are for code that looks like the page, and for Code blocks set to **Light**.
- **Dark colors** are for code that looks like the page in [dark mode](#dark-mode), and for Code blocks set to **Dark**.
- **Show code on the subtle background color** gives code that looks like the page the site's **Subtle background** color, instead of the background its colors were made for, so it matches the rest of the site. Some colors are harder to read on another background, so check how the code looks.

GitHub Light and GitHub Dark are the defaults.

## Visitors' consent

Videos from YouTube and Vimeo, Google forms and maps, and hCaptcha come from other sites, which can set cookies and see who visits; so can code pasted under **Code**, such as analytics. In many places, such as the European Union and the United Kingdom, visitors have to agree first. **Site Settings → General → Visitors' consent → Ask visitors before showing content from other sites** makes pages wait:

- **A notice** at the bottom of each page asks visitors, with **Allow** and **No, thanks** and a link to your privacy page, until they answer. Their answer is kept in their browser for **Ask again after this many days**, 180 by default, about six months; European regulators accept up to 395 days, 13 months. Then the notice asks again. A link to `#consent`, such as a "Privacy choices" link in the footer's menu, opens the notice again, so visitors can change their answer; taking back something they allowed reloads the page.
- **Kinds of content:** visitors can allow each kind on its own. Other sites' content (videos, maps, forms and hCaptcha) is always one; where the site's code is for statistics or advertising (see **Code** below), those are kinds of their own, and the notice gets **Choose**, which shows a box to tick for each kind and **Save my choices**. **Allow** allows every kind. When the site starts asking about a kind its visitors weren't asked about, the notice asks them again, keeping what they allowed.
- **Videos, Google forms and maps** from other sites load nothing until visitors agree: in their place, a note says where they come from, with a button that allows other sites' content and shows them. Uploaded videos and sound files are the site's own and play as always.
- **hCaptcha** on a form loads once visitors agree, with the same note and button in the form.
- **Custom HTML** used exactly as written waits too, when it has scripts, frames or anything else that loads: the same note and button show in its place until visitors agree. HTML that's made safe, or that loads nothing, shows at once.
- **Code:** what's at the end of the page, and the head's scripts, `<noscript>` and links to other sites, wait too, until visitors allow what it's for. **Site Settings → Code** says what each box is for: **Content from other sites** (as it comes), **Statistics**, such as Google Analytics, **Advertising**, or **Needed for the site to work**, which loads for everyone without asking, so choose it only for code that doesn't follow visitors. The head's `<meta>` tags, such as a site verification, its `<style>`, and its links to the site's own files, such as `<link rel="stylesheet" href="/extra.css">` or the site's icons, stay on every page. Code with `</template>` in it can't be published while the site asks, since it would run before visitors agree.

Every word of the notice can be changed. Words you leave as they come are in the site's main language where Goodfellow has words for it (English and Spanish), and on a site in [several languages](/docs/languages), in each language's too; each language's own words go on the **Languages** tab. Turning asking off and on again keeps the words you wrote. Visitors whose browser runs no JavaScript never see the notice, so nothing from other sites loads for them. The admin panel's editor and previews always show everything. Fonts aren't held back, since builds copy them into the site; if Google can't be reached when the site is built, pages load them from Google until the next build. Whether a site needs to ask, and what its privacy page says, depends on where it and its visitors are; this only makes asking possible.

## Redirects

**Site Settings → Redirects** sends visitors from old addresses to new ones, such as a page that moved, or the pages of a website this one replaced. Each redirect has:

- **Old address:** an address on this site, such as `/about-us`. You can paste the old page's full address, such as `https://old.example.org/about-us/`, and only its path is kept. Addresses with a `?` in them, such as `/?page_id=5`, can't be redirected, since a site made of files can't tell them apart from the address before the `?`.
- **Send visitors to:** a page on this site, such as `/about` (the field suggests the site's pages), or another website's address, starting with `https://`.

Addresses the site's build uses itself, such as `/media/`, `/feeds/` and `/api/`, can't be redirected, and neither can redirects that send visitors round in a circle, such as `/a` to `/b` and `/b` to `/a`.

**Change address** on the Pages screen adds a redirect from the page's old address, unless you untick **Keep … working**, and points redirects to the old address at the new one, so visitors never go through two.

On **Vercel**, Vercel sends the redirects itself, as permanent redirects, so visitors go straight to the new address: the site's `vercel.ts` gives them to Vercel, or, on a Next.js site, `withGoodfellow()` in `next.config.ts` does. (`next build` then warns that redirects don't work with a static export, which is true of other hosts, and why they get the pages below instead.)

On **Cloudflare Pages**, Cloudflare sends them too: the build writes them into a `_redirects` file next to the pages below, leaving out any from an address the site has a page at, since Cloudflare would send visitors on even from there. Cloudflare reads up to 2,000 lines of it, two for each old address (with and without a trailing slash), so past about 1,000 old addresses the build says so, and the pages below handle the rest.

Hosts such as GitHub Pages and GitLab Pages can't send redirects themselves, so when the site is built, each old address gets a small page that sends visitors on at once and tells search engines where the page is now. Search engines treat it as a permanent redirect, and Back skips it. For the moment it shows, or for good in browsers without JavaScript, it says **This page has moved to** and links to the page. **Message while visitors are sent on** changes the wording, such as to the site's own language; `{page}` in it becomes the link.

A page always wins: if a page or a collection's item has a redirect's old address, visitors see the page, and the Redirects tab says so.
