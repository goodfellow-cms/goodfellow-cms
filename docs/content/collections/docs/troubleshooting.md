---
version: 1
title: Troubleshooting
description: What to do when something doesn't work as expected, by what you see, such as a published change that isn't on the site, a sign-in that doesn't work, a domain without HTTPS, a failed build or updates that stopped.
section: owners
order: 7
---

Find what you're seeing below. Each answer says what usually causes it and what to do, and links to the page that explains more.

## I published, but the site didn't change

- **The site is still rebuilding.** Every publish rebuilds the site, which takes a minute or two, longer on Bitbucket and Vercel. The top of the admin panel says **Updating the live site…** until it's done, then **The live site is up to date**. Reload the page you're looking at then; your browser may also show its own copy for a little while.
- **The rebuild failed.** The top of the admin panel says **The live site couldn't be updated**. Your change is still published; **What went wrong?** says why, and [If the live site isn't updated](/docs/publishing#if-the-live-site-isnt-updated) says what to do about each reason.
- **The change went into a draft.** If a bar at the top of the screen says you're working in a draft, your change is kept there until the draft is published. Choose **Publish all** in the bar, or submit it for review ([Drafts](/docs/publishing#drafts)).
- **It was submitted for review.** An owner may have [limited what you can change](/docs/sign-in#limiting-what-editors-can-change); changes outside that are submitted for review instead of published, and go live once a reviewer publishes them.
- **The page is scheduled.** A page or item with a schedule shows only from its start, and goes at its end ([Scheduling](/docs/scheduling)). The Pages screen says when.
- **The change was to the site's code.** Blocks added or removed under **Blocks** show up once the site has rebuilt with them, and the editor offers them after that ([Add blocks](/docs/add-blocks)).

## I can't sign in

The sign-in screen says what went wrong. What each message means:

- **"That sign-in didn't work":** the token was copied only in part, has expired, or was revoked. Make a new one with the sign-in screen's link ([Signing in with a token](/docs/sign-in#signing-in-with-a-token)).
- **"That account can't see this site":** the token wasn't given access to the site's repository. On GitHub, choose **Only select repositories** and pick the site when you make it.
- **"That account can see the site but isn't allowed to change it":** the account needs write access to the repository, the Developer role on GitLab, or Write permission on Bitbucket. Ask an owner to [invite you](/docs/sign-in#inviting-and-removing-editors). Collaborators on someone else's personal GitHub repository need a classic token, from **Create a broader token instead**.
- **"Goodfellow isn't installed on this site":** the [sign-in service's](/docs/sign-in#signing-in-with-github) app needs installing on the repository once. An owner chooses **Install Goodfellow** on the sign-in screen; anyone else can sign in with a token meanwhile.
- **"needs the site's address in Site settings"** or **"works only at the site's own address":** signing in with GitHub works only at the address in **Site Settings → General**. Sign in with a token, add or correct the address, and sign in at that address after the site has rebuilt.
- **"works only on the published site":** signing in with GitHub doesn't work on your own computer. `goodfellow dev` and `next dev` need no sign-in.
- **"That account isn't an owner of this site":** the Editors, Domain and Updates screens' owner sign-in needs one of the site's owners: Admin on GitHub and Bitbucket, Maintainer on GitLab ([Inviting and removing editors](/docs/sign-in#inviting-and-removing-editors)).
- **"isn't available right now":** the sign-in service can't be reached, or has been used as much as it can be that day. Sign in with a token.
- **"You were signed out because your sign-in expired":** sign in again; changes to pages you were editing are kept in the browser ([Unpublished changes](/docs/publishing#unpublished-changes)). Signing in with Bitbucket lasts two hours.
- **"Couldn't reach…":** check the connection. A network that blocks GitHub, GitLab or Bitbucket blocks the admin panel too.

On a site with a [token broker](/docs/token-broker), editors sign in on the broker's page, and the admin panel says where if it's opened anywhere else.

## Someone else changed this page

Publishing stopped because someone else published changes to the same page or file since you opened it. Nothing was overwritten: **Reload** opens their version, so you can make your change again on top of it, and **Put my changes back** brings yours back to publish over theirs ([Working with other editors](/docs/publishing#working-with-other-editors)). To see what they changed, open the page's [version history](/docs/publishing#version-history).

## My domain doesn't work, or has no HTTPS

- **"Something else is there":** another DNS record with the same name points elsewhere, often the registrar's own parking page. Delete it at the registrar.
- **The records are in place, but HTTPS isn't ready:** hosts issue the certificate once they see the records, which can take up to a day. If it takes longer, look for a CAA record that leaves out Let's Encrypt, or Cloudflare's proxy in front of a site that isn't on Cloudflare Pages.
- **The site opens, but looks unstyled or its links are broken:** the site needs rebuilding for its new address. Publish any change, or use **Rebuild now** on the Updates screen.

[If it doesn't work](/docs/custom-domains#if-it-doesnt-work) on the Domain page has more.

## A block shows a note in the editor

Some blocks need something set up first, and say so in the editor, with a link to where it's done: a Form needs a form service in **Site Settings → General**, Share buttons and link previews need the Site address, Comments need **Site Settings → Comments**, and a block that adds pages of its own says why it can't on this page. Visitors never see these notes; until it's set up, the block shows nothing on the site, or only what works without it. [Built-in blocks](/docs/built-in-blocks) and [Forms](/docs/forms) say what each block needs.

## Fonts or pictures don't show

- **A picture is missing:** its file may have been deleted or renamed. Publishing lists links to media that doesn't exist ([Site checks](/docs/publishing#site-checks)); choose the picture again. A picture just uploaded shows in the editor at once, and on the site once it has rebuilt.
- **Pictures, videos or maps from other sites show a box asking first:** the site asks visitors before loading other sites' content ([Visitors' consent](/docs/layout-and-settings#visitors-consent)). They show once the visitor allows it.
- **The whole site looks unstyled:** usually the site's address or folder changed without a rebuild, as above. On a host other than the four Goodfellow sets up, check the [build's folder and addresses](/docs/any-host).
- **Your own font doesn't show:** check its files are WOFF2 and are still in the media library's fonts folder, which publishing reports if not ([Your own fonts](/docs/layout-and-settings#your-own-fonts)). While a font loads, pages show one of the computer's fonts in its place.
- **A Google font doesn't show:** builds copy Google's fonts into the site; if Google couldn't be reached during the build, pages load them from Google instead, which some networks block. The next rebuild copies them again.

## The admin panel can't open the site

If the admin panel says **Some of the site's files have problems**, a content file was changed outside the admin panel in a way it can't read, or was saved by a newer release of Goodfellow than the site's. Its details name each file and what's wrong with it. A developer can fix the file, or put back a version that worked from [the site's history](/docs/publishing#restoring-the-whole-site); a file from a newer release needs the site [updated](/docs/upgrading) first.

## The build failed

**What went wrong?** at the top of the admin panel names the step that failed and, where the build said, the file that caused it ([If the live site isn't updated](/docs/publishing#if-the-live-site-isnt-updated)):

- **Didn't start:** the account's free build minutes or billing on the host.
- **Packages couldn't be installed:** often a passing problem; publish again later.
- **A content file has a problem:** fix it in the admin panel, or put back a version from its version history.
- **The site's code:** undo a change under **Blocks** if there was one just before; otherwise a developer needs the host's details, behind **See the details**.

Developers can run `goodfellow build` on their computer to see the same problem, with `--strict` to fail on content problems too ([Commands](/docs/commands#site-checks)).

## Updates stopped

The Updates screen's **Last update** says when the last update ran and what it did ([The Updates screen](/docs/updates#the-updates-screen)). If nothing has been installed for a while:

- **There's nothing to install.** Fixes are installed on their own, but a new release that can change how things work, such as 0.9 for a site on 0.8, waits for an owner to choose **Update to …**.
- **Automatic fixes are off**, or the newest fix is among the releases the site went back from. The screen shows both.
- **The last update didn't build.** Every file went back as it was; the screen says why, and a developer may need to look. A plugin or theme that doesn't say it works with the new release is named on the screen.
- **Rebuilding overnight is set to Never**, which also stops fixes being installed on their own.
- **The setup doesn't run updates.** Sites made before the nightly check, and some on Vercel, need their setup files copied from a newer starter; on GitLab and Bitbucket, **Turn on automatic updates** has to be chosen once ([Turning it on](/docs/updates#turning-it-on)). Bitbucket's free plan has 50 build minutes a month, which a busy month can use up.

The [upgrade guide](/docs/upgrading) says how to bring an older site's setup up to date.
