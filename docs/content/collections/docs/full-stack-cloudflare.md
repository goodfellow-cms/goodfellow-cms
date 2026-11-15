---
version: 1
title: Full-stack sites on Cloudflare
description: Make a full-stack site whose editors sign in with the site's own accounts, on a Cloudflare Worker with a database, with one command.
section: developers
order: 7.2
---

`npm create goodfellow@latest my-site -- --server cloudflare` makes a [full-stack site](/docs/full-stack-nextjs) on Cloudflare: a Next.js app built with vinext, Cloudflare's build of Next.js, that runs as a Cloudflare Worker with a D1 database. It's for organizations whose editors shouldn't need GitHub accounts:

- Editors sign in with the site's own accounts. Admins invite them from `/admin/editors/`, and they choose a password from the link they're sent.
- The site's server publishes for them, with one token that can change only the content repository. What each editor publishes still names them as its author.
- Pages render from the content repository the first time they're visited after a publish and are kept until the next one, so a publish shows without a build.
- Pages can be for members only, readers can sign up, and the site can sell subscriptions through Stripe. Each stays unused until it's set up.

The site starts from Goodfellow's company example, with its pages: a home page, About, News, a Handbook for members only, and a Subscribe page. Change or delete them in the admin panel. Its README describes every part, and how to change it.

## What it asks

In a terminal, it asks for:

- the folder for the new site;
- the GitHub repository for the site's code, such as `your-name/your-site`;
- the GitHub repository for its content, the code's with `-content` after it unless you name another, such as `your-name/your-site-content`. The code and the content are always kept apart, as [Keep the content in a repository of its own](/docs/full-stack-nextjs#keep-the-content-in-a-repository-of-its-own) explains;
- the site's address, such as `https://www.example.org`, which you can leave for later.

Give them as options to answer nothing: `--github your-name/your-site --content your-name/your-site-content --url https://www.example.org`, where `--content` can be left out for the code's repository with `-content` after it. Full-stack sites are kept on GitHub for now.

It writes the site with those names in place: its Worker, its D1 database, and its KV namespace are named after the folder. The content is in `content-repository/`, a git repository of its own that `content/` and `public/media/` link to, as on any site whose content is kept apart. It then runs `npm install` and makes both folders git repositories with everything in a first commit. Push the content repository to GitHub first, then the code.

## Putting it online

In a terminal of your own, it then offers to put the site online with [wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare's command-line tool, asking before each step:

1. **Signing in** to Cloudflare, in wrangler's own browser window.
2. **The database and the cache:** it makes the D1 database and the KV namespace and writes their ids into `wrangler.jsonc`.
3. **Building and deploying** the site from your computer, which also sets up the database's tables.
4. **The secrets:** it makes the key that signs sessions and gives it to the Worker without showing it. Then wrangler asks for the GitHub token the site publishes with: a fine-grained token that can change the content repository and nothing else. Paste it only into wrangler's prompt.
5. **The first admin:** it asks for their email address and name, then the password, which it never shows or keeps.

Each step can be skipped. A skipped or failed step stops the ones after it, which need it, and the command lists what's left, with the step of the README that does it. Without the site's address, it stops after the database and the cache, since signing in needs the address the Worker is deployed with. It never offers these steps in CI, where nobody can sign in or type a secret.

Once it's online, the code repository's **Deploy** workflow builds and deploys the site after each change to its code, and the content repository's workflow asks it to after each publish. Both need secrets of their own on GitHub: their files, and the README, say which. The first admin then signs in and turns on two-factor sign-in at `/account/`, without which they can edit pages but not change Site Settings or manage editors.

## What it costs

Workers, D1, and KV have free plans. The first visit to a page after a publish renders it from the content repository, which can take more than the free plan's 10 milliseconds of CPU time on a large site, so plan on Workers Paid ($5 a month) unless your pages render within it. Email and Stripe are set up separately, as the README says, and the site works without them.
