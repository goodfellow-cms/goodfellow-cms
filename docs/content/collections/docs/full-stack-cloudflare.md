---
version: 1
title: Full-stack sites on Cloudflare
description: Make a full-stack site whose editors sign in with the site's own accounts, on a Cloudflare Worker with a database, from the setup page or with one command.
section: developers
order: 7.2
---

[Goodfellow's setup page for full-stack sites](/new-site/full-stack/), in your browser, or `npm create goodfellow@latest my-site -- --server cloudflare`, on a computer, makes a [full-stack site](/docs/full-stack-nextjs) on Cloudflare: a Next.js app built with vinext, Cloudflare's build of Next.js, that runs as a Cloudflare Worker with a D1 database. It's for organizations whose editors shouldn't need GitHub accounts:

- Editors sign in with the site's own accounts. Admins invite them from `/admin/editors/`, and they choose a password from the link they're sent.
- The site's server publishes for them, with one token that can change only the content repository. What each editor publishes still names them as its author.
- Pages render from the content repository the first time they're visited after a publish and are kept until the next one, so a publish shows without a build.
- Pages can be for members only, readers can sign up, and the site can sell subscriptions through Stripe. Each stays unused until it's set up.

The site starts from Goodfellow's company example, with its pages: a home page, About, News, a Handbook for members only, and a Subscribe page. Change or delete them in the admin panel. Its README describes every part, and how to change it.

## From the setup page

[The setup page for full-stack sites](/new-site/full-stack/) is a page of its own, apart from [the one for static sites](/new-site/). You sign in to GitHub there, as on the static sites' page, and give the site's name, who can see its files, and its address: a domain of your own, or nothing, for the address Cloudflare gives the Worker, `https://<worker>.<your-subdomain>.workers.dev`, which a domain can replace later. It then creates two repositories in your account, the code's and the content's with `-content` after its name, and connects them: where they're private, the code's Deploy workflow reads the content with a deploy key the page adds.

It then shows the site's **setup code** once, and lists what's left, with links to each place it's done:

1. **Cloudflare's token:** an API token from Cloudflare's "Edit Cloudflare Workers" template, and your account's ID, as the code repository's secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. **Publishing:** a fine-grained GitHub token that can change only the content repository, as the code repository's secret `GOODFELLOW_GIT_TOKEN`. Each deploy gives it to the Worker.
3. **Photos and files:** a fine-grained token that can only start the code repository's workflows, as the content repository's secret `GOODFELLOW_DEPLOY_TOKEN`, so new photos reach the site after each publish.
4. **Set up Cloudflare:** running the code repository's **Set up Cloudflare** workflow (`.github/workflows/setup-cloudflare.yml`) once. It makes the D1 database and the KV namespace, names them in `wrangler.jsonc`, and starts the Deploy workflow, which puts the site online. For a site without an address of its own, it asks Cloudflare for the account's workers.dev subdomain and writes the Worker's address in, which its run's summary shows. The first deploy makes the key that signs sessions and gives it only to the Worker.
5. **The domain**, for a site with one: adding the site's address to the Worker in Cloudflare's dashboard, under Workers & Pages → the Worker → Settings → Domains & Routes. To move a site on workers.dev to a domain later, add it there and put it in `wrangler.jsonc` as `GOODFELLOW_SITE_URL`, since signing in works only at that address.
6. **The first admin:** opening the site's `/setup/` page and giving the setup code with your email address, name, and password.

If creating the content's repository fails, **Create the site** tries again with the code's repository already made. After a reload, the page can't finish it, and says to delete the code's repository on GitHub and start again, or choose another name.

Until the Set up Cloudflare workflow has named the database and the cache, the Deploy workflow skips itself, so the commits the page makes don't fail it.

### The setup code

The setup code makes the site's first admin. The page makes it in your browser and shows it once: save it, such as in your password manager. Only its SHA-256 is kept, as `GOODFELLOW_SETUP_CODE_HASH` in `wrangler.jsonc`, so it can't be read from the repository, even a public one. The `/setup/` page takes it only while the site has no admin, ten tries an hour from one network address at most, and makes one admin with it, ever: once the site has had an admin, however it was made, `npm run new-admin` included, the code never works again, even where that admin is removed later. Every other admin is invited from `/admin/editors/`.

If you lose it before making the first admin, make the admin with `npm run new-admin` on a computer instead, as the README says, or put the hash of a new code of your own in `wrangler.jsonc`, such as `printf NEWCODE | sha256sum` gives for a code of capital letters and the digits 2 to 7, without spaces or dashes, and publish it.

## What the command asks

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

A site made with the command has done what the setup page's **Set up Cloudflare** workflow does, so it doesn't need it.

Once it's online, the code repository's **Deploy** workflow builds and deploys the site after each change to its code, and the content repository's workflow asks it to after each publish. Both need secrets of their own on GitHub: their files, and the README, say which. The first admin then signs in and turns on two-factor sign-in at `/account/`, without which they can edit pages but not change Site Settings or manage editors.

## What it costs

Workers, D1, and KV have free plans. The first visit to a page after a publish renders it from the content repository, which can take more than the free plan's 10 milliseconds of CPU time on a large site, so plan on Workers Paid ($5 a month) unless your pages render within it. Email and Stripe are set up separately, as the README says, and the site works without them.
