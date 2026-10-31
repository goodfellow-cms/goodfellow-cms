---
version: 1
title: Synced blocks
description: Keep a block once and show it on many pages, such as Mass times or a call to give, so changing it changes every page.
section: editors
order: 5.5
---

A synced block is a block, or several, kept once and shown wherever it's placed: on pages, in a collection's page design, and in the header or footer. Change it, publish, and every page that shows it changes. They suit things several pages share, such as Mass times, a call to give or a newsletter signup.

## Make one

There are two ways:

- **From a block on a page.** Choose the block in the page editor, then **Save as synced block** at the top, and give it a name. The block is published as a synced block at once, and a **Synced block** block takes its place on the page, which goes live when you publish the page. To save several blocks together, put them in a Section first, then save the Section.
- **On the Synced blocks screen.** **Synced blocks** at the top of the admin panel lists them. **New synced block** makes an empty one and opens it, to add blocks to as you would a page.

The name is only for editors, such as "Mass times": visitors never see it. **Rename** changes it without changing any page.

## Show one on a page

Add the **Synced block** block, from the Layout group, wherever it should go, and choose the synced block in its settings. The editor shows the synced block in its place with a dashed outline, and **Edit synced block** opens it. Its blocks can't be changed on the page, since that would change every page showing it.

To change it on one page alone, choose it and use **Detach**: its blocks take its place on that page, as blocks of the page's own, and the synced block and every other page stay as they are. **Undo** puts it back.

## Change one

Open it from the Synced blocks screen, or from **Edit synced block** on a page, and edit it as you would a page. The top of the editor says which pages show it. Publishing changes all of them at once.

A synced block can't show another synced block, so the Synced block block isn't offered there.

## Delete one

**Delete** on the Synced blocks screen deletes a synced block nothing shows. While pages, page designs, the header or the footer show it, it lists them instead: take its Synced block out of each, or detach it there, first.

## Several languages

On a site in [several languages](/docs/languages), pages in every language show the main language's synced block until a language has its own. In the synced block's editor, choose the language, then **Make a version for** it, which starts as a copy to translate. **Use the main language's version** takes that language's own version away.

## Who can change them

Synced blocks show on many pages, as the header and footer do, so an editor whose [limits](/docs/sign-in#limiting-what-editors-can-change) don't include the header and footer can place them on their pages, but not change them. [Site checks](/docs/publishing#site-checks) stop a publish that would leave a page placing a synced block that isn't there.
