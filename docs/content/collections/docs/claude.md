---
version: 1
title: Work with Claude
description: Connect Claude to your site, so it can read and change pages, items and settings, show them in screenshots, and publish them when you say so.
section: editors
order: 6.5
---

Goodfellow has a connector for [Claude](https://claude.ai), so you can work on your site by asking Claude: "add our summer fair to the events", "make the About page shorter", "what does the home page look like on a phone?". Claude reads the site's pages, items and settings, makes changes in a **draft**, shows you screenshots of them, and publishes them, or submits them for review, only when you say so.

It works with the sites' own blocks and settings, as the admin panel does: Claude sees what blocks the site has and what each one's settings are, and Goodfellow checks every change before it's saved.

## Connect Claude

Claude Desktop and Claude Code run Goodfellow's tools on your computer, signed in with tokens that stay there. One connection can work on several sites, on any of the hosts, and on sites in folders on your computer. Screenshots use the Google Chrome or Microsoft Edge you have.

### 1. Make a token

Claude needs a token for each host your sites are on, which can change the sites' files and, for submitting for review, open pull requests or merge requests. One token can cover several sites on the same host.

- **GitHub:** a [fine-grained token](https://github.com/settings/personal-access-tokens/new). Under **Repository access**, choose **Only select repositories** and pick the sites. Under **Permissions**, give it **Contents: Read and write** and **Pull requests: Read and write**, and **Pages: Read-only** for Claude to find a site's address on GitHub Pages by itself.
- **GitLab:** a [personal access token](https://gitlab.com/-/user_settings/personal_access_tokens) with the **api** scope. You need the Developer role or higher on each site's project.
- **Bitbucket:** a repository access token, made under the repository's **Repository settings → Access tokens**, with **Repositories: Write** and **Pull requests: Write**; or an API token, written as your email address, a colon, then the token. A repository access token covers one site only.

[Editors and sign-in](/docs/sign-in#signing-in-with-a-token) says more about each kind of token.

### 2. Add Goodfellow to Claude

**Claude Desktop:**

1. Download the [Goodfellow extension](https://goodfellow-cms.github.io/goodfellow-cms/goodfellow.mcpb), `goodfellow.mcpb`.
2. In Claude Desktop, open **Settings → Extensions**. Drag `goodfellow.mcpb` into that window, or choose **Advanced settings → Install Extension…** and pick the file. (Opening the file from your downloads may do the same.)
3. Claude shows what the extension is. Choose **Install**.
4. Fill in its settings, then choose **Save**:
   - **Sites**: each site's repository, separated by commas, such as `github:your-name/your-site, gitlab:your-group/other-site`. The repository is its address on the host after `github.com/`, `gitlab.com/` or `bitbucket.org/`.
   - **Sites in folders on this computer**: folders holding a site, if you work on one there (see [Sites on your computer](#sites-on-your-computer)).
   - **GitHub token**, **GitLab token**, **Bitbucket token**: the tokens from step 1, for the hosts your sites are on. Leave the others empty.
   - **GitLab address**: only for a GitLab of your own, such as `https://gitlab.example.org`.
5. Make sure the extension is turned on, then start a new conversation and ask Claude something like "What pages does my site have?"

Claude Desktop runs the extension itself, so there's nothing else to install. To change the sites or a token later, open **Settings → Extensions**, choose **Goodfellow**, then **Configure**.

**Claude Code:**

```sh
claude mcp add goodfellow --env GOODFELLOW_SITE="github:your-name/your-site, gitlab:your-group/other-site" --env GOODFELLOW_GITHUB_TOKEN=your-github-token --env GOODFELLOW_GITLAB_TOKEN=your-gitlab-token -- npx -y @goodfellow-cms/mcp
```

Give the token for each host your sites are on: `GOODFELLOW_GITHUB_TOKEN`, `GOODFELLOW_GITLAB_TOKEN` or `GOODFELLOW_BITBUCKET_TOKEN`, or `GOODFELLOW_TOKEN` for all of them. For a GitLab of your own, add `--env GITLAB_URL=https://gitlab.example.org`.

With several sites, Claude asks which one you mean, or you can say: "add a page to the school's site".

### Sites on your computer

Claude can work on a site in a folder on your computer, such as a copy of its repository you're developing, without a token. Name the folder in the extension's **Sites in folders on this computer**, or in Claude Code as a site of its own, its full path, such as `GOODFELLOW_SITE=C:\Sites\parish` or `local:/home/you/parish`.

Claude sees the site through its development server, so start it first in that folder (`npm run dev`). Claude looks for it at `http://localhost:4321`, where `goodfellow dev` runs, and `http://localhost:3000`, where `next dev` runs; if yours runs somewhere else, add `@` and its address after the folder, such as `C:\Sites\parish@http://localhost:4400`.

Changes wait in a draft, one at a time, kept beside the site's packages. Publishing writes them into the folder, where you commit and push them as you would any change, and the site's development server shows them straight away. Submitting for review isn't available for these sites.

### Through a connector service

A connector service lets editors add Goodfellow to Claude on the web, on phones and in Claude Code without a token, by signing in with GitHub, GitLab or Bitbucket. Goodfellow doesn't run one for everyone yet, and may in the future. An organization can run its own; see [Claude connector service](/docs/claude-connector). Then editors add it once:

1. In Claude, open **Settings → Connectors** and choose **Add custom connector**. (In a Claude Team or Enterprise organization, an owner adds it for everyone in the organization's settings.)
2. Name it **Goodfellow**, and give the connector's address, such as `https://claude.your-name.workers.dev/mcp`.
3. Choose **Connect**. Claude opens the connector's page, which asks where your site is stored: **Sign in with GitHub** or **Sign in with GitLab**.
4. Sign in, and choose the sites Claude may work on. Claude can only work on sites you can publish to.

Connectors you add on the web work in Claude's apps for computers and phones too. In Claude Code, add it with `claude mcp add --transport http goodfellow` and the connector's address.

On GitHub, Claude works on sites through the connector's GitHub App, **Goodfellow for Claude**, which an owner of the site installs on the site's repository. If it isn't installed on any site you edit, the connector's page offers to install it: GitHub's page lets you choose which repositories, and signs you in as it installs. Someone who isn't an owner asks an owner to install it, then connects again.

## Drafts

Claude never changes the live site straight away. The first change it makes starts a **draft**, a copy of the site that visitors don't see, and every later change goes into the same draft until you're happy with it. The site's editors see it in the admin panel too, where it can be finished like a [draft started there](/docs/publishing#drafts). Then ask Claude to:

- **Publish** it, which puts every change on the live site at once, as the admin panel's **Publish** does. The site is rebuilt and the changes go live in a minute or two.
- **Submit it for review**, so someone else checks it first. On GitHub and Bitbucket this opens a pull request, and on GitLab a merge request, asking the site's reviewers to look; whoever reviews it publishes it there, or in the admin panel.
- **Throw it away**.

Where an owner has [limited what you can change](/docs/sign-in#limiting-what-editors-can-change), Claude keeps to the same limits: it won't publish a draft that changes anything outside them, and submits it for review instead.

If someone publishes changes to the same pages in the admin panel while Claude's draft is open, publishing the draft stops rather than overwriting them, and Claude says so. It can make its changes again on top of theirs in a new draft.

### Turning off publishing

A site's owner can stop Claude publishing, so that every change it makes is checked by someone first. In the site's `goodfellow.config.tsx`, add:

```tsx
claude: { publish: false },
```

Once the site has been rebuilt with it, which publishing anything does, Claude can only submit its drafts for review. Claude can't change `goodfellow.config.tsx` itself: it only changes the site's content.

## Screenshots

Claude can look at a page as visitors see it, at a phone's or a computer's width, light or, on sites with dark mode, dark, live or with its draft's changes. Screenshots of drafts use a preview page in the site's admin panel, which shows the draft's files without publishing them. Claude can look at the photos and pictures in the media library the same way, to choose ones that fit.

On your computer, screenshots use your own browser, Chrome or else Edge, without a window. If it closes while taking a picture, Claude tries again, with the other browser where you have both, then says what the browser said. Security software that stops browsers running without a window, or an update waiting for the browser to restart, can cause that. A connector service uses Cloudflare's browsers, which Cloudflare's free plan allows for a few minutes a day for everyone using it. When they're used up, Claude says screenshots aren't available until later; everything else keeps working.

## What Claude can do

- Read pages, the header and footer, collections and their items, menus and the site's settings, and list the media library with each file's size and credit. Photos with a credit, such as those the AI assistant adds from Openverse, show it on every page that uses them, so Claude can use them as they are.
- Create, change and delete pages and items, and change the header and footer, menus and settings, in a draft.
- Show you a screenshot of any page, live or with its draft, or look at an image in the media library.
- Publish a draft, submit it for review, or throw it away.

Claude can't upload new photos, add or remove blocks from block registries, change who edits the site, or change the site's address; do those in the admin panel.

## Sites it works with

Claude reads what blocks the site has from the published site (its `goodfellow-site.json`, which every build writes), since the blocks are in the site's code, not its content. It finds the site at the address in **Site settings** (General → Site address), or, where that's empty, where GitHub Pages or GitLab Pages publishes it: the custom domain if it has one, otherwise its `github.io` or `gitlab.io` address. On GitHub that needs the token's **Pages: Read-only** permission, and on GitLab the Maintainer role or higher; otherwise, and on other hosts, put the address in Site settings. Screenshots of the live site use the same address.

Sites published before Goodfellow could work with Claude need publishing once more, which any change in the admin panel does. Claude works with sites made with the same or the previous minor version of Goodfellow, and asks the site's owner to update older ones on the [Updates](/docs/updates) screen.

### Many changes at once

Hosts limit how many requests a token can make in a minute. When Claude reaches the limit, it waits and carries on where the wait is short, and otherwise says when it can carry on; what it saved so far stays in the draft. Asking for fewer, larger changes, such as a whole page at once rather than a block at a time, uses fewer requests.

## What's kept

On your computer, the tokens stay in Claude's settings there, and Goodfellow keeps nothing but the draft of a site in a folder, in that folder's `node_modules/.goodfellow/`.

A connector service keeps nothing about you or your sites either. Who you are and which sites you chose are sealed inside the sign-in Claude keeps, with a key only the connector has, so they can't be read or changed. The one thing it stores is a number for each connection, so a stolen sign-in can't be renewed.

- **On GitHub,** your own GitHub sign-in is used only to see which sites you can edit, then cancelled straight away. Each time Claude works on a site, the connector gets a token for that site's repository only, which can change its files and open pull requests, checks with GitHub that you still edit the site, and cancels the token once Claude's request is answered. What Claude publishes names you as its author.
- **On GitLab,** which has no tokens for one project, Claude's sign-in holds your GitLab sign-in, sealed, renewed every two hours at most. It can reach every project you can, as signing in to the admin panel with GitLab does, though the connector only opens the sites you chose.

To disconnect, remove Goodfellow in Claude's settings, or on GitHub, uninstall the connector's app from the site's repository.
