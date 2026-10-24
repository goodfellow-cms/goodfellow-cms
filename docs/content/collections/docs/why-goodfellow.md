---
version: 1
title: Why Goodfellow
description: Why Goodfellow was made, what it's good at, and how it compares with WordPress, TinaCMS and other ways to run a website.
section: start
order: 2
---

Goodfellow started with a simple problem: small organizations, such as a parish, a club or a family business, need a website that volunteers can keep up to date. The usual answers each cost something they don't have. A WordPress site needs a server that someone keeps updated. A hosted website builder charges every month and keeps the content on its own servers. A modern static site is free to host and hard to break, but only a developer can change it.

Goodfellow aims to be all three good things at once: as easy to edit as a website builder, as cheap and safe to host as a static site, and owned by the site's owners rather than a company.

It isn't only for small organizations, though. The same design suits a company whose marketing team looks after the content while a development team looks after the code: see [For larger organizations](#for-larger-organizations).

## What makes it different

- **Visual editing for everything.** Editors drag blocks onto the page and see it as visitors will, header and footer included. The editor is [Puck](https://puckeditor.com), an open-source visual editor for React.
- **No server or database.** A Goodfellow site is static files. The admin panel is part of the site, and publishing saves to GitHub or GitLab straight from the editor's browser, so there's nothing to install, patch, back up or pay for besides the free host.
- **Your content is yours.** Every page is a readable file in your repository, with its whole history. You can move to another host, or another tool, whenever you like.
- **Made for people who've never used git.** The admin panel says "Publish", not "commit", and explains problems in plain words. Sign-in is a button or a token link with the right permissions already chosen.
- **Editors can do more without a developer.** Admins create collections and choose their fields, design the page every item shares, upload media, and add blocks from block registries, all from the admin panel.
- **AI help at no extra cost.** The AI assistant is built into the editor, for anyone who wants it. Editors can use a free AI service, or their own account with Claude or another service, and nothing goes through Goodfellow.
- **Built for developers to extend.** Any React component can become a block, sites can be part of a Next.js app, and the content format is documented.

## For larger organizations

Goodfellow started with small organizations, but nothing in it limits a site to them. It's built so that a marketing team can run a site's content while a development team owns its code, each working the way it already does:

- **Content and code kept apart.** The content can live in a [repository of its own](/docs/content-repository), so editors' sign-in can change pages, items and media but never the code, while developers change the code through their usual reviews and CI.
- **Your own design system.** Developers make any React component a block ([Write blocks](/docs/write-blocks)), and can publish their components as a [block registry](/docs/block-registries) for the company's sites to add blocks from. Editors then build pages from the blocks developers chose for the site, in its own theme.
- **Part of your Next.js app.** A site can be part of a [Next.js](/docs/nextjs) app, and a [full-stack](/docs/full-stack-nextjs) one signs editors in with the app's own sign-in, such as the company's single sign-on, gives them the app's owner and editor roles, and keeps the only token to the repository, and the AI keys, on its server.
- **Checks before anything goes live.** Every publish is [checked](/docs/publishing#site-checks) for links to pages and media that don't exist, pages without a title or description, and accessibility problems, and builds run the same checks, with axe-core on every page. `goodfellow build --strict` fails a build with errors, so CI can stop a change that would break links ([Commands](/docs/commands)).
- **Every change on record.** Each publish is a commit naming the editor who made it, with [version history](/docs/publishing#version-history) for every page and the whole site, and going back is a publish like any other. Changes made with [Claude](/docs/claude-connector) can wait as drafts and be submitted for review as a pull or merge request.
- **Several languages,** with each translation linked to the page it translates, and the ones that have fallen behind it flagged ([Several languages](/docs/languages)).
- **Services you run yourselves.** An organization can run the [sign-in service](/docs/sign-in-service), which gives editors hour-long tokens for one repository, and the [Claude connector](/docs/claude-connector) for all its sites.

- **Sign-in kept away from the site's code.** Blocks and previews run in a sandbox that can't reach editors' sign-in, and an admin address or a [token broker](/docs/token-broker) keeps it away from the site's pages too. See [Security](/docs/security).

Some of what larger teams ask for is still on the [roadmap](https://github.com/goodfellow-cms/goodfellow-cms#roadmap): publishing several pages at once and submitting them for review from the admin panel, limiting what each editor may change, and plugins, which owners will install only on sites with an admin address or a token broker.

## How Goodfellow compares

These comparisons are as of October 2026. The other products change too, so check their own pages before deciding.

### WordPress

[WordPress](https://wordpress.org) runs a large share of the web, and for good reason: it has thousands of themes and plugins, a mature block editor, and features such as comments, shops and member logins that a static site can't offer by itself.

The trade-off is that WordPress is a program that has to run on a server, with PHP and a MySQL or MariaDB database. Someone has to pay for that server and keep WordPress, its theme and its plugins up to date, because they're a common target: Patchstack recorded [11,334 new vulnerabilities in the WordPress ecosystem in 2025](https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/), 91% of them in plugins. WordPress.com hosts sites for free, but its free plan shows WordPress.com's ads, uses a `wordpress.com` address and doesn't allow plugins; see [its plans](https://wordpress.com/pricing/).

**Choose WordPress** if the site needs a shop, memberships, comments or other features that need a server, or a particular plugin. **Choose Goodfellow** if the site is mainly pages and news that volunteers, staff or a marketing team keep up to date, and you'd rather have no server to maintain or pay for.

### TinaCMS

[TinaCMS](https://tina.io) is the closest relative. Like Goodfellow, it's open source, keeps content as files (Markdown, MDX or JSON) in a git repository, and lets editors see changes on the page as they make them.

The biggest difference is the editor. In Tina, the page is shown beside a sidebar of forms, and blocks are added, reordered and changed as items in those forms. Goodfellow uses [Puck](https://puckeditor.com), where editors drag blocks onto the page itself, move them around there and edit them where they are, which is much quicker to learn. Goodfellow also has an AI assistant built in, at no cost.

The other differences are about who it's for. Tina's content model, its collections and fields, is defined in code in `tina/config`, so adding a new kind of content or a field takes a developer, while Goodfellow's admins do it in the admin panel. Tina also needs a backend: either Tina Cloud, whose [free plan](https://tina.io/pricing) covers two users and whose paid plans start at $24 a month per project, or a backend you host yourself, which needs serverless functions, a database and an authentication provider. Goodfellow needs no backend of your own: editors use their own GitHub or GitLab accounts, signing in with GitLab or with a GitHub token (or through a small sign-in service a site can run for free), and there's no limit on how many.

**Choose TinaCMS** if a developer builds and looks after the site, and wants rich Markdown and MDX editing in the framework of their choice. **Choose Goodfellow** if the people running the site should be able to build pages and change how content is organized themselves, whether or not developers make its blocks.

### Other options

- **Git-based form editors** such as [Decap CMS](https://decapcms.org) and [Sveltia CMS](https://github.com/sveltia/sveltia-cms), which Goodfellow's sign-in and publishing design learned from, edit Markdown and data through forms. They're simple and free, but pages are designed in code, so editors change what's on them rather than how they look.
- **Hosted website builders** such as Wix and Squarespace are easy to use, but cost a monthly fee for a site with its own domain, and the site lives on their platform.

## What Goodfellow can't do (yet)

- **It's early.** Goodfellow is new, and some features, such as plugins and limiting what each editor may change, are still on the [roadmap](https://github.com/goodfellow-cms/goodfellow-cms#roadmap). Moving from WordPress, and back to it, [works already](/docs/move-from-wordpress).
- **Sites are static.** Shops, member logins and comments need a service of their own, or a developer who makes the site part of a [Next.js app with a server](/docs/full-stack-nextjs). Contact forms work through a form service; see [Forms](/docs/forms).
- **Publishing takes a minute or two**, while the host rebuilds the site. The editor shows changes at once, but visitors see them after the rebuild.
- **Editors need a GitHub or GitLab account** with permission to change the site's repository, except on [full-stack Next.js sites](/docs/full-stack-nextjs), where they sign in with the app's own accounts.
- **Free hosts have rules.** Some free plans don't allow business sites; see [Hosts and business sites](/docs/hosts).
