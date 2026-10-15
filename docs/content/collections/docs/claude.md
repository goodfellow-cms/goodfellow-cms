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

Goodfellow runs the connector for every site, free. Add it to Claude once:

1. In Claude, open **Settings → Connectors** and choose **Add custom connector**. (In a Claude Team or Enterprise organization, an owner adds it for everyone in the organization's settings.)
2. Name it **Goodfellow**, and give its address: `https://claude.goodfellow-cms.workers.dev/mcp`.
3. Choose **Connect**. Claude opens Goodfellow's page, which asks where your site is stored: **Sign in with GitHub** or **Sign in with GitLab**.
4. Sign in, and choose the sites Claude may work on. Claude can only work on sites you can publish to.

Connectors you add on the web work in Claude's apps for computers and phones too. In Claude Code, add it with:

```sh
claude mcp add --transport http goodfellow https://claude.goodfellow-cms.workers.dev/mcp
```

### The first time on GitHub

On GitHub, Claude works on sites through the **Goodfellow for Claude** app, which an owner of the site installs on the site's repository. If it isn't installed on any site you edit, Goodfellow's page offers to install it: GitHub's page lets you choose which repositories, and signs you in as it installs. Someone who isn't an owner asks an owner to install it, then connects again.

## Drafts

Claude never changes the live site straight away. The first change it makes starts a **draft**, a copy of the site that only Claude and you see, and every later change goes into the same draft until you're happy with it. Then ask Claude to:

- **Publish** it, which puts every change on the live site at once, as the admin panel's **Publish** does. The site is rebuilt and the changes go live in a minute or two.
- **Submit it for review**, so someone else checks it first. On GitHub this opens a pull request, and on GitLab a merge request; whoever reviews it publishes it there.
- **Throw it away**.

If someone publishes changes to the same pages in the admin panel while Claude's draft is open, publishing the draft stops rather than overwriting them, and Claude says so. It can make its changes again on top of theirs in a new draft.

### Turning off publishing

A site's owner can stop Claude publishing, so that every change it makes is checked by someone first. In the site's `goodfellow.config.tsx`, add:

```tsx
claude: { publish: false },
```

Once the site has been rebuilt with it, which publishing anything does, Claude can only submit its drafts for review. Claude can't change `goodfellow.config.tsx` itself: it only changes the site's content.

## Screenshots

Claude can look at a page as visitors see it, at a phone's or a computer's width, live or with its draft's changes. Screenshots of drafts use a preview page in the site's admin panel, which shows the draft's files without publishing them. Claude can look at the photos and pictures in the media library the same way, to choose ones that fit.

Screenshots use Cloudflare's browsers, which Goodfellow's connector can use for a few minutes a day for everyone. When they're used up, Claude says screenshots aren't available until later; everything else keeps working.

## What Claude can do

- Read pages, the header and footer, collections and their items, menus and the site's settings, and list the media library with each file's size and credit. Photos with a credit, such as those the AI assistant adds from Openverse, show it on every page that uses them, so Claude can use them as they are.
- Create, change and delete pages and items, and change the header and footer, menus and settings, in a draft.
- Show you a screenshot of any page, live or with its draft, or look at an image in the media library.
- Publish a draft, submit it for review, or throw it away.

Claude can't upload new photos, add or remove blocks from block registries, change who edits the site, or change the site's address; do those in the admin panel.

## Sites it works with

Claude needs the site's address in **Site settings**, since it reads what blocks the site has from the published site. Sites published before Goodfellow could work with Claude need publishing once more, which any change in the admin panel does. Claude works with sites made with the same or the previous minor version of Goodfellow, and asks the site's owner to update older ones on the [Updates](/docs/updates) screen.

## What's kept

Goodfellow's connector keeps nothing about you or your sites. Who you are and which sites you chose are sealed inside the sign-in Claude keeps, with a key only the connector has, so they can't be read or changed. The one thing it stores is a number for each connection, so a stolen sign-in can't be renewed.

- **On GitHub,** your own GitHub sign-in is used only to see which sites you can edit, then cancelled straight away. Each time Claude works on a site, the connector gets a token for that site's repository only, which can change its files and open pull requests, checks with GitHub that you still edit the site, and cancels the token once Claude's request is answered. What Claude publishes names you as its author.
- **On GitLab,** which has no tokens for one project, Claude's sign-in holds your GitLab sign-in, sealed, renewed every two hours at most. It can reach every project you can, as signing in to the admin panel with GitLab does, though the connector only opens the sites you chose.

To disconnect, remove the connector in Claude's settings, or on GitHub, uninstall the Goodfellow for Claude app from the site's repository.

## On your own computer

Claude Desktop and Claude Code can also run Goodfellow's tools on your computer, signed in with a token instead of through Goodfellow's connector. The token stays on your computer, and screenshots use the Google Chrome or Microsoft Edge you have.

The token needs to be able to change the site's files and, for submitting for review, open pull requests (GitHub) or merge requests (GitLab). [Editors and sign-in](/docs/sign-in#signing-in-with-a-token) explains making one; on GitHub, give it **Pull requests: Read and write** too.

- **Claude Desktop:** download the [Goodfellow extension](https://goodfellow-cms.github.io/goodfellow-cms/goodfellow.mcpb), open it, and choose **Install**. Claude asks for the site, such as `github:your-name/your-site` or `gitlab:your-group/your-site`, and the token.
- **Claude Code:**

  ```sh
  claude mcp add goodfellow --env GOODFELLOW_SITE=github:your-name/your-site --env GOODFELLOW_TOKEN=your-token -- npx -y @goodfellow-cms/mcp
  ```

  For a GitLab of your own, add `--env GITLAB_URL=https://gitlab.example.org`.

Organizations can also run their own copy of the connector; see [Claude connector service](/docs/claude-connector).
