---
version: 1
title: Add blocks
description: Add more blocks to the editor from the admin panel, and remove them, without a developer.
section: owners
order: 1
---

The admin panel's **Blocks** screen adds more blocks to the editor, from Goodfellow's block registry, most of them built with [shadcn/ui](https://ui.shadcn.com). They're listed by kind, with the recommended ones marked:

| Block | What it's for |
|---|---|
| Hero | A large heading at the top of a page, with text, buttons and a picture |
| Cards | A grid of cards, each with a picture, a heading, text and a link |
| Call to action | A highlighted box asking visitors to do something, with a button |
| Testimonials | Quotes from people, with their names and photos |
| Notice | A short message that stands out, such as a closure or a change of times |
| Pricing table | Plans side by side, with prices, what each includes and a button |
| FAQ | Questions that open to show their answers |
| Tabs | Content split into tabs, one shown at a time |
| Image carousel | Pictures shown one at a time, with buttons to move between them |
| Custom HTML | HTML written by hand, such as a widget's embed code. It's made safe (scripts, styles, frames and forms left out) unless you choose to use it exactly as written |
| News feed | The latest items of another site's RSS or Atom feed, such as a diocese's news or a podcast's episodes: titles linking to them, with their dates |
| Map | A Google map of an address or place, or of the embed code from Google Maps' **Share** button. No API key needed |
| Social links | Links to the site's pages on Facebook, Instagram, YouTube and X, each shown as the network's mark |
| Panel | A box with its title in a colored bar, other blocks inside it, and an optional button at its foot |
| Slideshow with quick links | Full-width pictures that fade from one to the next, with a badge, such as a logo, and a column of quick links over them |
| Content with section links | A page's blocks beside a list of the other pages in its part of the menu, the current one marked |
| People | The people of an organization, such as its staff or council, each with a photo, their name, role and a few words |
| Logos | A row of logos, such as sponsors or partners, each linking to its site |
| Numbers | A few numbers worth knowing, such as families served or years open, each with what it counts |
| Timeline | Moments in order down a line, such as an organization's history or the steps of a plan |
| Countdown | The days, hours, minutes and seconds until a moment, in the site's time zone |
| Comments | Comments on the page through [Giscus](https://giscus.app), kept as GitHub Discussions in a repository you choose |

Sites whose [content is kept apart from their code](/docs/content-repository) have no Blocks screen, since adding a block changes the code: their developer adds blocks. On a [full-stack Next.js site](/docs/full-stack-nextjs), whose server runs blocks' code, the Blocks screen submits the changes for review, for a developer to accept, rather than publishing them.

## Adding a block

**Add** and **Remove** mark blocks to add or remove; **Publish** then makes every change in one save, and **Discard changes** forgets them. Publishing writes each added block's code into the site's repository, as a developer running `npx shadcn add` would: the block goes in `blocks/installed/`, and the shadcn components it uses in `components/ui/`. The editor offers it once the site has been rebuilt, a minute or two after publishing. Like the built-in blocks, these use the site's colors, fonts and corner rounding.

FAQ, Tabs, Image carousel, Slideshow with quick links, Countdown and Comments are interactive. The FAQ's answers and the tabs' content are in the page even when hidden, so search engines and search boxes find them. The slideshow has a button to stop it, stops while the pointer or the keyboard is on it, and doesn't move by itself for visitors whose computer or phone asks for less motion.

Countdown counts to a day and time in the site's time zone (Site Settings, under General). Without JavaScript, and to screen readers, it says when the moment is; once it has come, it shows what you chose to say then, and the site is built again that day so pages say it without JavaScript too.

Comments keeps each page's comments as a discussion in a GitHub repository, through Giscus, and visitors sign in with GitHub to write one. On [giscus.app](https://giscus.app), name a public repository with Discussions turned on and Giscus installed, choose a category, and copy the code at the end of the page into the block. Pages are matched to their discussions by their address, so moving a page starts a new discussion. Giscus is another site's content, so it loads only on the built site, never in the editor, and on a site that [asks visitors first](/docs/layout-and-settings#visitors-consent) it waits until they agree.

News feed reads the feed when the site is built, not in the editor, which says where its items will come from, and asks for the site to be built again the next day, so a site [rebuilt overnight](/docs/updates#rebuilding-overnight) keeps it current. It shows only the items' titles, links and dates. If the feed can't be read, the page is built without it, showing the block's text for that.

Content with section links finds the pages to list in a menu (`main` unless you name another): the submenu of the top-level link the page is under, or, on a page under one of those submenu's pages, such as one ministry under "Ministries", the pages beside it. On a collection's page design, **Show the links as if on this page** lists them as on another page, such as the list of news.

Custom HTML used exactly as written runs its scripts on the site. The editor only shows it, in a sealed-off frame where it can't reach the admin panel, without running its scripts, so a widget that a script builds shows on the published site but not in the editor. Only use HTML you trust that way. On a [full-stack Next.js site](/docs/full-stack-nextjs#who-may-do-what), only its owners can choose it. Its scripts run whenever its page is shown, also when visitors move to it from another page of a Next.js site. A page with such scripts loads React, as pages with interactive blocks do.

## Removing a block

A block can't be removed while a page, a collection's page design, the header or the footer uses it; the Blocks screen lists where it's used. Removing deletes its files, except those someone has changed since it was added, or that another block still uses.

## Other registries

Developers can publish registries of Goodfellow blocks built with other component libraries; see [Block registries](/docs/block-registries). For a shadcn component no registry has as a block, a developer can make one with `goodfellow blocks add` (see [Any shadcn component as a block](/docs/shadcn-components)), and the Blocks screen then lists and removes it like the others. A site offers blocks from the registries its developer lists only where the admin panel has [an address of its own](/docs/custom-domains#an-admin-address) or a [token broker](/docs/token-broker), because a block's code runs in the admin panel, which at the site's own address shares it with scripts on the site's pages. Elsewhere the Blocks screen offers only Goodfellow's registry. On a developer's computer, in `goodfellow dev` or `next dev`, where the admin panel holds no tokens, it offers them all, and adding a block there writes its code into the site's files, to commit like any other change.
