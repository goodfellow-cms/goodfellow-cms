---
version: 1
title: Add blocks
description: Add blocks built with shadcn/ui to the editor from the admin panel, and remove them, without a developer.
section: owners
order: 1
---

The admin panel's **Blocks** screen adds more blocks to the editor, from Goodfellow's block registry, built with [shadcn/ui](https://ui.shadcn.com). They're listed by kind, with the recommended ones marked:

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

Sites whose [content is kept apart from their code](/docs/content-repository) have no Blocks screen, since adding a block changes the code: their developer adds blocks.

## Adding a block

**Add** and **Remove** mark blocks to add or remove; **Publish** then makes every change in one save, and **Discard changes** forgets them. Publishing writes each added block's code into the site's repository, as a developer running `npx shadcn add` would: the block goes in `blocks/installed/`, and the shadcn components it uses in `components/ui/`. The editor offers it once the site has been rebuilt, a minute or two after publishing. Like the built-in blocks, these use the site's colors, fonts and corner rounding.

FAQ, Tabs and Image carousel are interactive. The FAQ's answers and the tabs' content are in the page even when hidden, so search engines and search boxes find them.

Custom HTML used exactly as written runs its scripts on the site. The editor only shows it, in a sealed-off frame where it can't reach the admin panel, without running its scripts, so a widget that a script builds shows on the published site but not in the editor. Only use HTML you trust that way. Its scripts run whenever its page is shown, also when visitors move to it from another page of a Next.js site. A page with such scripts loads React, as pages with interactive blocks do.

## Removing a block

A block can't be removed while a page, a collection's page design, the header or the footer uses it; the Blocks screen lists where it's used. Removing deletes its files, except those someone has changed since it was added, or that another block still uses.

## Other registries

Developers can publish registries of Goodfellow blocks built with other component libraries; see [Block registries](/docs/block-registries). For a shadcn component no registry has as a block, a developer can make one with `goodfellow blocks add` (see [Any shadcn component as a block](/docs/shadcn-components)), and the Blocks screen then lists and removes it like the others. A site offers blocks from the registries its developer lists only where the admin panel has [an address of its own](/docs/custom-domains#an-admin-address) or a [token broker](/docs/token-broker), because a block's code runs in the admin panel, which at the site's own address shares it with scripts on the site's pages. Elsewhere the Blocks screen offers only Goodfellow's registry. On a developer's computer, in `goodfellow dev` or `next dev`, where the admin panel holds no tokens, it offers them all, and adding a block there writes its code into the site's files, to commit like any other change.
