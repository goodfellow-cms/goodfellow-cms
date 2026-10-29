---
version: 1
title: Create a site
description: Make a new Goodfellow site from a starter, in your browser or on your own computer.
section: start
order: 3
---

## In your browser

The [setup page](/new-site) creates a site without installing anything. It asks what the site is for first, so it can recommend a host whose free plan allows it, then which starter to begin from and where to keep the site's files: GitLab, with GitLab Pages, for every kind of site (see [Which to choose](/docs/hosts#which-to-choose)), or GitHub. The rest of `create-goodfellow`'s questions, below, are under **Advanced settings**, already set to what suits most sites, which the page sums up in one line: which blocks, who can see the files, where to put the site online, where to keep the content, and where editors sign in. With a sign-in page of its own, it creates the broker's repository beside the site's, and you set its address on the site's **Site Settings → Security** once both are online. **Continue** goes to the second step, where you sign in, choose the account and the name, and the page creates the repository in your GitHub or GitLab account, with the site's files in its first commit, and turns on GitHub Pages or GitLab Pages. Its address holds your choices, and **Change** goes back to them.

- **Signing in:** on GitHub, paste a token the page links to, with the permissions it needs filled in, and choose **All repositories** under Repository access, since the repository doesn't exist yet. (Goodfellow doesn't run a sign-in service for Sign in with GitHub yet, and may in the future.) The token is used only in that tab and never saved; delete it on GitHub once the site is created. On GitLab, sign in with GitLab or paste a token in the same way.
- **Business and private sites:** GitLab Pages works with private projects, and the page makes a private project's site public. GitHub Pages isn't for business sites and doesn't work with private repositories on GitHub's free plan, so on GitHub the page recommends Cloudflare Pages for those.
- **Cloudflare Pages:** the page creates the repository, then you import it in Cloudflare's dashboard, with the build settings the page shows, and add the Pages project's deploy hook to the repository for the nightly update and rebuild.
- **Vercel:** the page creates the repository, then you import it at [vercel.com/new](https://vercel.com/new).
- **Content in a repository of its own:** for organizations with a developer, the page can keep the content in a [repository of its own](/docs/content-repository), so editors can change the content but never the code. It creates both repositories and connects them.
- **History:** on GitHub, the page also adds a rule that stops anyone rewriting or deleting the main branch's history, where the plan allows it. GitLab does this for every project.

The site's first build starts at once. Once it's online, sign in to its admin panel, at the site's address followed by `/admin/`: see [Editors and sign-in](/docs/sign-in).

## With create-goodfellow

You need [Node.js](https://nodejs.org) 22.23.4 or later, 24.22.1 or later, or 26.12.1 or later. Earlier versions have a security problem that a calendar feed or another site the build reads could use to run code on the computer building the site.

```sh
npm create goodfellow@latest my-site
```

It asks these questions, with menus you move through with the arrow keys and choose from with Enter:

- **Which site to start from:** the **Starter** (a home page, an about page and a news section), the **Parish example** (a complete made-up parish site, with collections and blocks of its own) or the **Starter for Next.js** (see [Next.js](/docs/nextjs)).
- **Where the site will be stored:** GitHub, GitLab or Bitbucket, and the repository's name.
- **Where it will be hosted:** GitHub Pages, GitLab Pages, Cloudflare Pages or Vercel, with each host's rules for business sites. Only that host's setup files are kept; Cloudflare Pages gets setup files of its own, for its nightly update and rebuild. A site on Bitbucket is hosted on Vercel, with `bitbucket-pipelines.yml` for its nightly update (see [Put it online](/docs/put-it-online#3-choose-a-host)).
- **Where the content will be kept:** with the code, or, for organizations with a developer, in a [repository of its own](/docs/content-repository), so editors can change the content but never the code.
- **Where editors sign in:** in the admin panel at the site's address, at an admin address of its own (where the host serves a site at more than one address), or at a sign-in page of its own, a [token broker](/docs/token-broker), which it writes into a folder beside the site's. It asks first whether you have a domain: with one, on a host that can serve an admin address, that's the choice it starts with; otherwise it recommends the sign-in page, which needs a domain only on GitHub Pages. See [Security](/docs/security).
- **Which blocks to start with:** the recommended blocks from Goodfellow's [block registry](/docs/add-blocks), such as an FAQ and tabs, or the built-in blocks only. Either way, blocks can be added and removed later in the admin panel.

It then runs `npm install`, and makes the new folder a git repository on the branch `main`, with everything, `package-lock.json` included, in its first commit and `origin` set when you gave it the repository. `--no-install` and `--no-git` leave those out; it also doesn't make a repository inside another git repository.

To skip the questions, give the answers as options:

```sh
npm create goodfellow@latest my-site -- --template parish --github your-name/your-site --host github-pages --blocks built-in
```

`--gitlab your-group/your-site` and `--bitbucket your-workspace/your-site` store it on GitLab or Bitbucket instead. `--admin https://admin.example.org` gives editors an admin address of its own, `--broker gitlab-pages` (or `github-pages` with `--broker-domain signin.example.org`, `cloudflare-pages` or `vercel`) writes a token broker beside the site, `--content your-name/your-site-content` keeps the content in a repository of its own, and `--wordpress wordpress-export.xml` (or a WordPress site's address) starts the site with a WordPress site's pages, posts, menus and media; see [Move from WordPress](/docs/move-from-wordpress). `--plugin goodfellow-plugin-guestbook`, once for each, installs a [plugin](/docs/plugins#install-a-plugin-from-the-admin-panel) as the admin panel would, saying what it asks to do. Run it with `--help` for every option.

> To try changes that haven't been released yet, use the sites in [the repository](https://github.com/goodfellow-cms/goodfellow-cms) instead: install [pnpm](https://pnpm.io) 12, run `pnpm install` and `pnpm build` at the root, then `pnpm dev` in `templates/starter`.

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
├── goodfellow.config.tsx    # the site's blocks, plugins and where it's stored
├── blocks/                  # the site's own blocks, and blocks/installed/ from block registries
├── components/ui/           # shadcn components that installed blocks use
├── plugins/installed/       # the plugins installed from the admin panel, and what each was approved to do
├── content/                 # everything the admin panel edits
│   ├── site.json            # name, logo, colors, fonts, contact details
│   ├── menus.json           # navigation menus
│   ├── layout/header.json   # the header and footer
│   ├── pages/index.json     # one file per page, named after its address
│   ├── collections/news/    # a collection: its settings and one file per item
│   └── styles/custom.css    # custom CSS from Site Settings
├── public/media/            # uploaded images and files
├── src/styles.css           # Tailwind and the site's theme
├── .npmrc                   # installing packages runs none of their install scripts
└── .github/workflows/deploy.yml, .gitlab-ci.yml, vercel.ts   # host setups (bitbucket-pipelines.yml on Bitbucket)
```

None of a site's packages need an install script, the code a package can run when it's installed, so `.npmrc` turns them off, here and in every build. If a package you add needs one, run `npm rebuild <package>` after installing it, in the site's build too.

Next, [put it online](/docs/put-it-online).
