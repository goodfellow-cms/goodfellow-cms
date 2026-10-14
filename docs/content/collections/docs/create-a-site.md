---
version: 1
title: Create a site
description: Make a new Goodfellow site from a starter, in your browser or on your own computer.
section: start
order: 3
---

## In your browser

The [setup page](/new-site) creates a site without installing anything. It asks the same questions as `create-goodfellow`, below, and what the site is for, so it can recommend a host whose free plan allows it. Then it creates the repository in your GitHub or GitLab account, with the site's files in its first commit, and turns on GitHub Pages or GitLab Pages.

- **Signing in:** on GitHub, paste a token the page links to, with the permissions it needs filled in. Choose **All repositories** under Repository access, since the repository doesn't exist yet. The token is used only in that tab and never saved; delete it on GitHub once the site is created. On GitLab, sign in with GitLab or paste a token.
- **Private sites:** GitHub Pages doesn't work with private repositories on GitHub's free plan, so the page recommends GitLab for a site whose files are private. GitLab Pages works with private projects, and the page makes a private project's site public.
- **Vercel:** the page creates the repository, then you import it at [vercel.com/new](https://vercel.com/new).
- **History:** on GitHub, the page also adds a rule that stops anyone rewriting or deleting the main branch's history, where the plan allows it. GitLab does this for every project.

The site's first build starts at once. Once it's online, sign in to its admin panel, at the site's address followed by `/admin/`: see [Editors and sign-in](/docs/sign-in).

## With create-goodfellow

You need [Node.js](https://nodejs.org) 22 or later.

```sh
npm create goodfellow@latest my-site
```

It asks:

- **Which site to start from:** the **Starter** (a home page, an about page and a news section), the **Parish example** (a complete made-up parish site, with collections and blocks of its own) or the **Starter for Next.js** (see [Next.js](/docs/nextjs)).
- **Where the site will be stored:** GitHub or GitLab, and the repository's name.
- **Where it will be hosted:** GitHub Pages, GitLab Pages or Vercel, with each host's rules for business sites. Only that host's setup file is kept.
- **Which blocks to start with:** the recommended blocks from Goodfellow's [block registry](/docs/add-blocks), such as an FAQ and tabs, or the built-in blocks only. Either way, blocks can be added and removed later in the admin panel.

It then runs `npm install`, and makes the new folder a git repository on the branch `main`, with everything, `package-lock.json` included, in its first commit and `origin` set when you gave it the repository. `--no-install` and `--no-git` leave those out; it also doesn't make a repository inside another git repository.

To skip the questions, give the answers as options:

```sh
npm create goodfellow@latest my-site -- --template parish --github your-name/your-site --host github-pages --blocks built-in
```

Run it with `--help` for every option.

> To try changes that haven't been released yet, use the sites in [the repository](https://github.com/goodfellow-cms/goodfellow-cms) instead: install [pnpm](https://pnpm.io), run `pnpm install` and `pnpm build` at the root, then `pnpm dev` in `templates/starter`.

## Try it on your computer

In the new site's folder, where `npm create goodfellow` has already run `npm install`:

```sh
npm run dev
```

The site is at <http://localhost:4321>, and the admin panel at <http://localhost:4321/admin>, unless another program already uses that port: `npm run dev` prints the address it uses. On your own computer the admin panel saves straight to the files in `content/`, with no sign-in, and pages show your changes when you reload them.

```sh
npm run build    # writes the finished site to dist/
npm run preview  # serves dist/ the way a host would
```

## What's in a site

```text
my-site/
├── goodfellow.config.tsx    # the site's blocks and where it's stored
├── blocks/                  # the site's own blocks, and blocks/installed/ from block registries
├── components/ui/           # shadcn components that installed blocks use
├── content/                 # everything the admin panel edits
│   ├── site.json            # name, logo, colors, fonts, contact details
│   ├── menus.json           # navigation menus
│   ├── layout/header.json   # the header and footer
│   ├── pages/index.json     # one file per page, named after its address
│   ├── collections/news/    # a collection: its settings and one file per item
│   └── styles/custom.css    # custom CSS from Site Settings
├── public/media/            # uploaded images and files
├── src/styles.css           # Tailwind and the site's theme
└── .github/workflows/deploy.yml, .gitlab-ci.yml, vercel.ts   # host setups
```

Next, [put it online](/docs/put-it-online).
