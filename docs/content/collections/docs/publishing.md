---
version: 1
title: Publishing
description: How publishing works, how long it takes, and what happens when two people edit at once.
section: editors
order: 2
---

**Publish** saves what you changed to the site's repository on GitHub, GitLab or Bitbucket, as one change, from your own browser. The host then rebuilds the site, usually within a minute or two, and the top of the admin panel shows when the live site has been updated, or that the rebuild failed, with a link to the details. Publishing several pages one after another doesn't cost a rebuild each: on GitLab Pages, a publish made while the site is still rebuilding cancels that rebuild and builds both, and on GitHub Pages, the publishes made during a rebuild share the next one.

## Site checks

Before publishing, the admin panel checks what the change would do to the site:

- **Links that go nowhere stop a publish:** a link to a page, an item or a file in the media library that the site doesn't have, wherever it is: in a block, a menu, an item's fields (an item's link to another item included), Site Settings or a redirect. That includes links a publish would break elsewhere, such as deleting a page that other pages link to, or deleting a photo they use. Go back, fix or remove the links, and publish again. Moving never stops a publish: changing a page's or an item's address, or the address pattern of a collection's items, changes every link to them on the site in the same publish.
- **Synced blocks that aren't there stop a publish:** a page, a collection's design, the header or the footer placing a [synced block](/docs/synced-blocks) the site doesn't have, or one that doesn't say which it shows, and a synced block showing another synced block. Links inside synced blocks are checked like a page's, and move with the pages they link to.
- **Links that would run code stop a publish too:** an address such as `javascript:…` or `data:…` in a link, a menu or an item's fields. Pages leave such links out when they're built, whatever the checks say, so a visitor's browser never runs them.
- **Some things are only suggestions:** a page with no title, a page with no description when the site has none either, and [theme colors](/docs/layout-and-settings#colors-and-contrast) that make text hard to read. The pages you're publishing are also checked as they'll show, for images with no description for people who can't see them, headings that skip a level (such as a level 4 straight after a level 2), and links whose text, such as "Click here" or "Read more", doesn't say where they go, or that have no text at all. On a site in [several languages](/docs/languages#checking-translations), pages and items without a translation, or whose translation is out of date, are listed when the publish brings them. These are listed for the files you're publishing, and **Publish anyway** goes ahead.

An image that's only there to look nice, such as a pattern, needs no description: choose **Only decoration** in its settings. A collection's design is checked on its first item's page, and the header and footer on the home page.

Links that were already broken before you started don't stop you publishing something else; they're listed as suggestions when you publish the page they're on. Uploading files, the site's address on the **Domain** screen and update settings publish without the checks, since they can't break a link.

## If the live site isn't updated

When a rebuild fails, the top of the admin panel says the live site couldn't be updated. Your changes are still published; visitors see the site as it was until a rebuild works, and every publish tries again. **What went wrong?** explains why, in plain words, with the host's own details behind a toggle:

- **The rebuild didn't start:** usually the account the site belongs to has used up its free build minutes for the month, or its billing needs attention.
- **Packages couldn't be installed:** sometimes a passing problem with the service the packages come from, so publishing again later may work.
- **Pages isn't set up:** one of the site's owners needs to turn on GitHub Pages or GitLab Pages in the site's settings on the host.
- **A content file has a problem:** fix it, or put back a version that worked from its [version history](#version-history).
- **The site's code couldn't be built:** if its blocks changed just before, undo that under **Blocks**; otherwise a developer needs to look at the details.

[Troubleshooting](/docs/troubleshooting) has more on what to do when a publish doesn't show up on the site.

On GitHub, seeing which step failed needs the token's **Actions** permission, which the sign-in link fills in. Tokens made before it did can still publish, but the admin panel can only say that the rebuild failed.

## Working with other editors

Several people can edit the same site. If someone else published changes to other pages while you were editing, publishing still goes ahead. If they changed the same page or file, publishing stops and explains what happened, instead of overwriting their work; **Reload** shows their version in the editor, so you can make your change again on top of it, or choose **Put my changes back** to publish yours over theirs.

## Version history

Every publish is kept. In a page's editor, **Version history** lists each version of the page that's been published, newest first, with who published it and when. Choose a version to see a preview of it, then choose **Restore this version** to put it back. Restoring publishes that version again as a new change, so the version it replaced stays in the history, and you can restore that one too.

The header, the footer and each item in a collection have a **Version history** button in their editors as well. A few things to know:

- **Versions that can't be restored:** one that uses blocks the site doesn't have any more, until they're added again under **Blocks**, and an item whose values no longer fit its collection's fields, such as a choice that's since been removed. An item's values for fields removed since are left out.
- **Moved pages:** a page moved to a new address starts a new history there.
- **Where it works:** in the published site's admin panel, where you sign in with GitHub, GitLab or Bitbucket. There's no history in a demo, or when the site runs on your own computer.

## Restoring the whole site

When a change to many pages at once goes wrong, such as an import or a bulk edit, the whole site can go back to how it was. **Site Settings → Site history** lists every publish that changed the site's pages, items, settings or media, newest first. Choose one to see:

- **What has changed since:** the pages, items, settings and media files that are different now, in three lists: changed since, added since (which restoring removes) and removed since (which restoring brings back).
- **How the site looked then:** choose any page to preview it as it was, with its pictures.

Then choose **Restore the site as it was** to put everything back in one publish. Like restoring one page, it's a new change of its own, so the site as it was before stays in the history, and you can restore that too. A few things to know:

- **What's restored:** everything in `content/` and `public/media/`: pages, collections and their items, the header and footer, Site Settings, menus, redirects, custom CSS and code, photo credits, and media files. The site's code, the blocks added under **Blocks**, and the [update settings](/docs/updates) stay as they are.
- **Sites that can't be restored:** a version that uses blocks the site doesn't have any more, until they're added again under **Blocks**.
- **Who can:** Site Settings is for owners, so on a [full-stack Next.js site](/docs/full-stack-nextjs), editors can't restore the whole site.

## Downloading a copy

**Download a copy**, at the top of **Site Settings → Site history**, downloads the site's content as one zip file, named after the site and the day, such as `my-site-2026-11-01.zip`, to keep somewhere safe: everything in `content/` (pages, collections and their items, the header and footer, Site Settings, menus, redirects, custom CSS and code, photo credits and descriptions), the media library in `public/media/`, the lists of the blocks and plugins the site added (`blocks/installed/installed.json` and `plugins/installed/installed.json`), and `goodfellow-transfer.json`, which says which release of Goodfellow made it. It's the site as the admin panel shows it, with a draft you're working in included. It works on every site, demos and sites on your own computer too.

It doesn't hold the site's code, such as its own blocks, the blocks added under **Blocks** and its setup files, which are kept where the site is stored: download them there, with **Code → Download ZIP** on GitHub, **Code → Download source code** on GitLab, or **Download repository** in a repository's menu on Bitbucket. Media kept in a [storage service](/docs/media#media-kept-in-a-storage-service) stays there; the copy's `content/media-storage.json` lists it.

Another Goodfellow site can import a copy on **Site Settings → Import / Export**, adding it to its content or replacing its content with it (see [Move content between Goodfellow sites](/docs/move-between-sites)). To make a site again from a copy without one, a developer [makes a new site](/docs/create-a-site#with-create-goodfellow) from the same starter, replaces its `content/` and `public/media/` folders with the copy's, adds the blocks and plugins the two lists name (under **Blocks** and **Plugins**, or with `--plugin` when making it), and publishes it. A site whose code was downloaded too needs only the copy's folders put back in it.
- **Where it works:** as with a page's version history, in the published site's admin panel.

## Drafts

To publish changes to several pages together, with one rebuild, keep them in a **draft** first. In an editor, **Add to draft**, beside **Publish**, or Ctrl+S (⌘S on a Mac), starts a draft with your change instead of publishing it. While you're working in a draft, a bar at the top of every screen says so, and every **Publish** button says **Add to draft**: pages, items, the header and footer, Site Settings and the media library all save into the draft. Visitors don't see any of it until it's published. The bar has:

- **Publish all**, which runs the [site checks](#site-checks) over everything in the draft, then publishes it in one change, with one rebuild. If someone else has published changes to the same pages or settings since the draft started, it stops rather than overwriting them, and the draft is kept: submit it for review, or throw it away and make the changes again.
- **Submit for review**, so someone else checks it first. On GitHub and Bitbucket this opens a pull request, and on GitLab a merge request, asking the site's reviewers to look: every owner, unless [Limits](/docs/sign-in#limiting-what-editors-can-change) names some people. The bar then says the draft is submitted, with **See it** for the review on the host.
- **Throw away**, which deletes the draft and leaves the live site as it is.
- **Back to the live site**, which leaves the draft for later.

A draft stays when you close the tab, and the admin panel opens it again next time. Other editors see it too: when there's a draft, the bar says so and offers to open it, including drafts [Claude](/docs/claude#drafts) started, which can be finished in the admin panel. Drafts waiting for review come first, for owners: the bar names the one waiting, with **See it**. A reviewer can publish it on the host, or open it here and **Publish all** or **Throw away**, which also closes its review.

Drafts are kept on branches of the site's repository named `goodfellow-draft-…`, which the starters' setups never build. Cloudflare Pages, Netlify and Vercel build previews of every branch unless told not to, so their [setup steps](/docs/put-it-online#3-choose-a-host) turn previews off.

On a [full-stack Next.js site](/docs/full-stack-nextjs), in a [demo](/docs/demo-mode) and when the site runs on your own computer, there are no branches to keep it on, so the draft is kept in your browser instead: it stays when the tab closes, but other editors don't see it, it can't be submitted for review, and another browser or computer doesn't have it. A full-stack site's server can still take changes outside someone's [limits](/docs/sign-in#limiting-what-editors-can-change) for review.

## Unpublished changes

Leaving a screen with unpublished changes asks first, so nothing is lost by accident.

While you edit a page, the header or footer, a collection's design or an item, the admin panel keeps your changes in the browser as you go, so closing the tab, a crash or a sign-in that runs out doesn't lose them. Open the same thing again in that browser, and a bar says you have changes from then that weren't published, with **Put them back** and **Throw them away**. If someone has published changes to it since, the bar says so: putting yours back and publishing them replaces theirs.

Kept changes aren't published, and nobody else sees them: only that browser has them. They go once you publish them or add them to a draft, or undo them, and after 30 days. Signing out forgets them, so the next person on the computer doesn't find them. Site Settings and the other screens with forms don't keep their changes, so publish those before closing the tab.

## In development

When the site runs on your own computer with `npm run dev`, Publish writes straight to the files in `content/`, with no sign-in.
