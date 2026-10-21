---
version: 1
title: Publishing
description: How publishing works, how long it takes, and what happens when two people edit at once.
section: editors
order: 2
---

**Publish** saves what you changed to the site's repository on GitHub or GitLab, as one change, from your own browser. The host then rebuilds the site, usually within a minute or two, and the top of the admin panel shows when the live site has been updated, or that the rebuild failed, with a link to the details.

## Site checks

Before publishing, the admin panel checks what the change would do to the site:

- **Links that go nowhere stop a publish:** a link to a page, an item or a file in the media library that the site doesn't have, wherever it is: in a block, a menu, an item's fields, Site Settings or a redirect. That includes links a publish would break elsewhere, such as deleting a page that other pages link to, or deleting a photo they use. Go back, fix or remove the links, and publish again. Moving never stops a publish: changing a page's or an item's address, or the address pattern of a collection's items, changes every link to them on the site in the same publish.
- **Some things are only suggestions:** a page with no title, a page with no description when the site has none either, and [theme colors](/docs/layout-and-settings#colors-and-contrast) that make text hard to read. The pages you're publishing are also checked as they'll show, for images with no description for people who can't see them, headings that skip a level (such as a level 4 straight after a level 2), and links whose text, such as "Click here" or "Read more", doesn't say where they go, or that have no text at all. These are listed for the files you're publishing, and **Publish anyway** goes ahead.

An image that's only there to look nice, such as a pattern, needs no description: choose **Only decoration** in its settings. A collection's design is checked on its first item's page, and the header and footer on the home page.

Links that were already broken before you started don't stop you publishing something else; they're listed as suggestions when you publish the page they're on. Uploading files, the site's address on the **Domain** screen and update settings publish without the checks, since they can't break a link.

## If the live site isn't updated

When a rebuild fails, the top of the admin panel says the live site couldn't be updated. Your changes are still published; visitors see the site as it was until a rebuild works, and every publish tries again. **What went wrong?** explains why, in plain words, with the host's own details behind a toggle:

- **The rebuild didn't start:** usually the account the site belongs to has used up its free build minutes for the month, or its billing needs attention.
- **Packages couldn't be installed:** sometimes a passing problem with the service the packages come from, so publishing again later may work.
- **Pages isn't set up:** one of the site's owners needs to turn on GitHub Pages or GitLab Pages in the site's settings on the host.
- **A content file has a problem:** fix it, or put back a version that worked from its [version history](#version-history).
- **The site's code couldn't be built:** if its blocks changed just before, undo that under **Blocks**; otherwise a developer needs to look at the details.

On GitHub, seeing which step failed needs the token's **Actions** permission, which the sign-in link fills in. Tokens made before it did can still publish, but the admin panel can only say that the rebuild failed.

## Working with other editors

Several people can edit the same site. If someone else published changes to other pages while you were editing, publishing still goes ahead. If they changed the same page or file, publishing stops and explains what happened, instead of overwriting their work; reload the page to see their version, then make your change again.

## Version history

Every publish is kept. In a page's editor, **Version history** lists each version of the page that's been published, newest first, with who published it and when. Choose a version to see a preview of it, then choose **Restore this version** to put it back. Restoring publishes that version again as a new change, so the version it replaced stays in the history, and you can restore that one too.

The header, the footer and each item in a collection have a **Version history** button in their editors as well. A few things to know:

- **Versions that can't be restored:** one that uses blocks the site doesn't have any more, until they're added again under **Blocks**, and an item whose values no longer fit its collection's fields, such as a choice that's since been removed. An item's values for fields removed since are left out.
- **Moved pages:** a page moved to a new address starts a new history there.
- **Where it works:** in the published site's admin panel, where you sign in with GitHub or GitLab. There's no history in a demo, or when the site runs on your own computer.

## Unpublished changes

Leaving a screen with unpublished changes asks first, so nothing is lost by accident. Changes aren't saved anywhere until you publish, so publish before closing the tab.

## In development

When the site runs on your own computer with `npm run dev`, Publish writes straight to the files in `content/`, with no sign-in.
