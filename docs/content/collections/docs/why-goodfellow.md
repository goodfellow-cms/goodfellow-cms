---
version: 1
title: Why Goodfellow
description: Why Goodfellow was made, what it's good at, and how it compares with WordPress, TinaCMS and other ways to run a website.
section: start
order: 2
---

Goodfellow started with a simple problem: small organizations, such as a parish, a club or a family business, need a website that volunteers can keep up to date. The usual answers each cost something they don't have. A WordPress site needs a server that someone keeps updated. A hosted website builder charges every month and keeps the content on its own servers. A modern static site is free to host and hard to break, but only a developer can change it.

Goodfellow aims to be all three good things at once: as easy to edit as a website builder, as cheap and safe to host as a static site, and owned by the site's owners rather than a company.

## What makes it different

- **Visual editing for everything.** Editors drag blocks onto the page and see it as visitors will, header and footer included. The editor is [Puck](https://puckeditor.com), an open-source visual editor for React.
- **No server or database.** A Goodfellow site is static files. The admin panel is part of the site, and publishing saves to GitHub or GitLab straight from the editor's browser, so there's nothing to install, patch, back up or pay for besides the free host.
- **Your content is yours.** Every page is a readable file in your repository, with its whole history. You can move to another host, or another tool, whenever you like.
- **Made for people who've never used git.** The admin panel says "Publish", not "commit", and explains problems in plain words. Sign-in is a button or a token link with the right permissions already chosen.
- **Editors can do more without a developer.** Admins create collections and choose their fields, design the page every item shares, upload media, and add blocks from block registries, all from the admin panel.
- **AI help at no extra cost.** The AI assistant is built into the editor, for anyone who wants it. Editors can use a free AI service, or their own account with Claude or another service, and nothing goes through Goodfellow.
- **Built for developers to extend.** Any React component can become a block, sites can be part of a Next.js app, and the content format is documented.

## How Goodfellow compares

These comparisons are as of October 2026. The other products change too, so check their own pages before deciding.

### WordPress

[WordPress](https://wordpress.org) runs a large share of the web, and for good reason: it has thousands of themes and plugins, a mature block editor, and features such as comments, shops and member logins that a static site can't offer by itself.

The trade-off is that WordPress is a program that has to run on a server, with PHP and a MySQL or MariaDB database. Someone has to pay for that server and keep WordPress, its theme and its plugins up to date, because they're a common target: Patchstack recorded [11,334 new vulnerabilities in the WordPress ecosystem in 2025](https://patchstack.com/whitepaper/state-of-wordpress-security-in-2026/), 91% of them in plugins. WordPress.com hosts sites for free, but its free plan shows WordPress.com's ads, uses a `wordpress.com` address and doesn't allow plugins; see [its plans](https://wordpress.com/pricing/).

**Choose WordPress** if the site needs a shop, memberships, comments or other features that need a server, or a particular plugin. **Choose Goodfellow** if the site is mainly pages and news that volunteers or staff keep up to date, and you'd rather have nothing to maintain or pay for.

### TinaCMS

[TinaCMS](https://tina.io) is the closest relative. Like Goodfellow, it's open source, keeps content as files (Markdown, MDX or JSON) in a git repository, and lets editors see changes on the page as they make them.

The biggest difference is the editor. In Tina, the page is shown beside a sidebar of forms, and blocks are added, reordered and changed as items in those forms. Goodfellow uses [Puck](https://puckeditor.com), where editors drag blocks onto the page itself, move them around there and edit them where they are, which is much quicker to learn. Goodfellow also has an AI assistant built in, at no cost.

The other differences are about who it's for. Tina's content model, its collections and fields, is defined in code in `tina/config`, so adding a new kind of content or a field takes a developer, while Goodfellow's admins do it in the admin panel. Tina also needs a backend: either Tina Cloud, whose [free plan](https://tina.io/pricing) covers two users and whose paid plans start at $24 a month per project, or a backend you host yourself, which needs serverless functions, a database and an authentication provider. Goodfellow has no backend at all; editors use their own GitHub or GitLab accounts, and there's no limit on how many.

**Choose TinaCMS** if a developer builds and looks after the site, and wants rich Markdown and MDX editing in the framework of their choice. **Choose Goodfellow** if the people running the site should be able to build pages and change how content is organized themselves.

### Other options

- **Git-based form editors** such as [Decap CMS](https://decapcms.org) and [Sveltia CMS](https://github.com/sveltia/sveltia-cms), which Goodfellow's sign-in and publishing design learned from, edit Markdown and data through forms. They're simple and free, but pages are designed in code, so editors change what's on them rather than how they look.
- **Hosted website builders** such as Wix and Squarespace are easy to use, but cost a monthly fee for a site with its own domain, and the site lives on their platform.

## What Goodfellow can't do (yet)

- **It's early.** Some features on the [roadmap](https://github.com/goodfellow-cms/goodfellow-cms#roadmap), such as signing in with GitHub without a token and the Claude connector, aren't built yet.
- **Sites are static.** Shops, logins and comments need a service of their own. Contact forms will work through a form service.
- **Publishing takes a minute or two**, while the host rebuilds the site. The editor shows changes at once, but visitors see them after the rebuild.
- **Editors need a GitHub or GitLab account** with permission to change the site's repository.
- **Free hosts have rules.** Some free plans don't allow business sites; see [Hosts and business sites](/docs/hosts).
