---
version: 1
title: Comments
description: Let visitors comment on pages with the Comments block, which keeps their comments on GitHub through Giscus, on Disqus, or in Garrul on your own Cloudflare account, and set it up and moderate it in Site Settings.
section: owners
order: 1.5
---

A Goodfellow site has no server to keep comments on, so the **Comments** block keeps them with one of three services instead:

- **[Giscus](https://giscus.app)**, a free service that keeps each page's comments as a discussion in a public GitHub repository of their own, kept apart from the site's. Anyone can read them, and visitors sign in with GitHub to write one or react to the page. It shows no ads and keeps nothing about visitors, but visitors without a GitHub account can't comment.
- **[Disqus](https://disqus.com)**, which keeps comments on its own service. Visitors sign in with Disqus or another account Disqus offers, or comment as guests where you allow it, so far more of them can comment. Its free plan shows ads with the comments, and Disqus tracks visitors for them; see [Use Disqus](#use-disqus).
- **[Garrul](https://github.com/KingPin/Garrul)**, free software you run in a Cloudflare account of your own, on Cloudflare's free plan, so the comments stay yours, with no ads. Visitors comment as guests, behind Cloudflare's Turnstile check, or sign in with GitHub, Google, Facebook, X or Discord. Someone used to running commands on a computer has to set it up first; see [Use Garrul](#use-garrul).

Comments is a block from Goodfellow's block registry, so it's added on the **Blocks** screen; see [Add blocks](/docs/add-blocks). Choose where comments are kept in **Site Settings**, under **Comments**. On a site kept on GitHub, the admin panel sets Giscus up for you and lets you moderate its comments there. On a site kept on GitLab or Bitbucket, Giscus takes about ten minutes on GitHub; see [Set it up on GitHub](#set-it-up-on-github). Disqus and Garrul work the same way on every site.

## Set up Giscus in the admin panel

On a site kept on GitHub:

1. Open **Site Settings**, then **Comments**.
2. Choose **Make a new project for comments**, and keep the name it suggests, such as `website-comments`, or give it another. It's made in the same account or organization as the site's repository. If you already have a public repository for comments, choose **Use a project I already have** and type its name, such as `stjoseph/website-comments`, instead.
3. Choose **Set up comments**. The admin panel makes the repository with Discussions turned on, finds its **Announcements** category, which only Giscus and the repository's owners can start discussions in, and publishes where comments are kept.
4. Choose **Install Giscus**, then choose **Only select repositories**, pick the comments' repository, and choose **Install**. Giscus's app starts a discussion for each page that gets its first comment, and posts visitors' comments in it as them. GitHub doesn't let other apps install it for you, so this step is yours.
5. On the **Blocks** screen, add **Comments** and publish. The editor offers the block once the site has been rebuilt, a minute or two later.
6. Open a page, or a [collection's page design](/docs/collections) to have comments under every item, such as every news story, add the **Comments** block where the comments should go, and publish.

### If it asks for a GitHub token

If editors sign in through a [sign-in service](/docs/sign-in-service), the admin panel can reach only the site's own repository, not a new one beside it, so it asks for a GitHub token of your own:

1. Choose **Create a token on GitHub**. The link fills in what comments need (a classic token that can manage public repositories); choose how long it lasts, then **Generate token**.
2. Copy the token, paste it into **GitHub token**, and choose **Use this token**.

The token is kept only in that browser tab, and forgotten when you sign out or close it. With a [token broker](/docs/token-broker), you paste it into the broker's own page instead, which keeps it so the admin panel never sees it.

### Stop using comments

Choose **Stop using comments** on the same screen. Pages stop showing comments once the site has been rebuilt; everything visitors wrote stays in the repository on GitHub, so you can set comments up with it again later.

## Moderate comments

For comments kept by Disqus or Garrul, see [Use Disqus](#use-disqus) and [Use Garrul](#use-garrul). For Giscus's, **Site Settings**, **Comments** lists what visitors have written, the pages commented on most recently first, with each page's comments and their replies. For each comment you can:

- **Hide** it, as spam, abusive or off topic. It stays on the page, folded away and marked with why, until you choose **Show again**.
- **Delete** it for good, with any replies to it.
- **Open on GitHub**, to reply or see it there.

For each page, **Close to new comments** stops anyone adding more, and **Open to new comments** lets them again.

To keep someone out altogether, block them on GitHub: in your account's or organization's **Settings**, under **Moderation**. To pause comments everywhere for a while, limit who can comment in the comments repository's **Settings**, under **Moderation options**. GitHub emails the repository's owners about new comments, as it does for any discussion; choose what you're told about with the repository's **Watch** button.

## Set it up on GitHub

On a site kept on GitLab or Bitbucket, or to keep comments somewhere the admin panel didn't set up, do the same on GitHub yourself.

### 1. Make a repository for the comments

Comments are kept in a repository's Discussions, which visitors must be able to see, so the repository has to be public.

1. On [GitHub](https://github.com), choose **+** at the top, then **New repository**.
2. Give it a name, such as `website-comments`, and choose **Public**.
3. Choose **Create repository**.

### 2. Turn on Discussions

1. In the repository, open **Settings**.
2. Under **Features**, tick **Discussions**.

### 3. Let Giscus use the repository

1. Open [Giscus's app on GitHub](https://github.com/apps/giscus) and choose **Install**.
2. Choose where to install it: your account, or the organization the repository is in.
3. Choose **Only select repositories**, pick the comments' repository, and choose **Install**.

### 4. Copy Giscus's code

1. Open [giscus.app](https://giscus.app).
2. Under **Repository**, type the repository's owner and name, such as `stjoseph/website-comments`. Giscus says when it's ready; if it doesn't, check the three steps above.
3. Under **Discussion Category**, choose **Announcements**. Only Giscus and the repository's owners can start discussions in it, so nobody can start one by hand.
4. Leave the other choices as they are: the block sets them itself, matching each page by its address and following the site's language and dark mode.
5. Under **Enable giscus**, copy the code, which starts with `<script src="https://giscus.app/client.js"`.

### 5. Add the block

1. On the **Blocks** screen, add **Comments** and publish.
2. Add the **Comments** block to a page or a collection's page design, paste the code into **Giscus's code**, and publish.

A block with Giscus's code shows the comments the code names, whatever Site Settings says, so one page can keep its comments somewhere else. Moderate these on GitHub: open the repository's **Discussions** tab, where each page's discussion is named after its address, such as `news/parish-fair`, and use a comment's **…** menu to hide or delete it, or **Lock conversation** to stop comments on a page.

## Use Disqus

1. On [Disqus](https://disqus.com/admin/create/), make an account if you don't have one, then make a site for yours. Disqus asks for its name and gives it a **shortname**, such as `stjoseph`, which its addresses start with.
2. In Disqus's settings for the site, add the site's address as its website, and choose the comments' language, whether visitors may comment as guests, and whether new comments wait for your approval.
3. In the admin panel, open **Site Settings**, then **Comments**. Under **Use Disqus**, paste the shortname, or the code Disqus gives you when you choose to install it on a site, which names it, and choose **Use Disqus**.
4. On the **Blocks** screen, add **Comments** and publish, then add the **Comments** block to a page or a collection's page design and publish.

Disqus matches each page to its comments by the page's address on the site, so the site needs its address in Site settings for Disqus to link back to pages. To keep one page's comments with another Disqus site, paste that site's shortname or code into the block's **Giscus's, Disqus's or Garrul's code**.

Moderate Disqus's comments on Disqus: **Site Settings**, **Comments** links to **Moderate comments on Disqus**, where you approve, hide and delete comments, and block people. Choose in Disqus's settings what it emails you about. **Stop using comments** on the same screen stops pages showing them once the site has been rebuilt, leaving everything visitors wrote on Disqus.

## Use Garrul

Garrul runs as a Cloudflare Worker, with Cloudflare's D1 database, in your own Cloudflare account. Goodfellow doesn't run it for you: you, or a developer, set it up once, and keep it up to date.

1. Follow [Garrul's instructions](https://github.com/KingPin/Garrul) to set it up on Cloudflare, with an address of its own, such as `https://comments.example.org`, rather than a `workers.dev` one. Its setup asks for a Cloudflare Turnstile key, which keeps robots from commenting as guests.
2. In Garrul's settings, `wrangler.toml`, add the site's address to `ALLOWED_ORIGINS`, along with any other address the site is seen at, such as a [staging copy](/docs/staging), and put your own email address in `ADMIN_EMAILS`. Garrul shows comments only on the addresses it allows.
3. In the admin panel, open **Site Settings**, then **Comments**. Under **Use Garrul**, paste its address, or the code its instructions give for a page, which names it, and choose **Use Garrul**.
4. On the **Blocks** screen, add **Comments** and publish, then add the **Comments** block to a page or a collection's page design and publish.

The block names each page's comments by its address, such as `/news/parish-fair`, and gives Garrul the page's title and full address, which it uses in its emails and feeds. It shows Garrul in the site's language where Garrul has it, and in light colors unless the site has [dark mode](/docs/layout-and-settings) turned on.

Moderate Garrul's comments on Garrul: **Site Settings**, **Comments** links to **Moderate comments on Garrul**, its queue of comments waiting for approval, where you sign in with the email address in `ADMIN_EMAILS`. Its settings choose whether new comments wait for approval, and it can tell you about new ones by email, Telegram, Slack or Discord. **Stop using comments** on the same screen stops pages showing them once the site has been rebuilt, leaving everything visitors wrote in Garrul.

## Choices

- **Heading** shows above the comments. Leave it empty for none.
- **Giscus's, Disqus's or Garrul's code** is only for comments kept somewhere other than Site Settings says. Leave it empty to show the ones set up there.
- **Reactions to the page (Giscus)** shows or hides the row of reactions, such as 👍 and ❤️, above the comments. Disqus has its own setting for reactions, on Disqus.
- **Box for writing a comment (Giscus)** puts it above the comments or under them. Disqus and Garrul have their own.

The editor shows a note where the comments will be, rather than the comments themselves, since Giscus, Disqus and Garrul load only on the published site. Open the page on the site to see it.

## Things to know

- **With Giscus, visitors need a GitHub account to comment**, though not to read. Many people without one won't comment, so Giscus suits sites whose visitors are likely to have one, or where a few comments are enough. Disqus and Garrul let anyone comment.
- **Giscus's comments are public on GitHub**, with the commenters' names, and stay in the repository however the site changes. Disqus's stay on Disqus, and Garrul's in your Cloudflare account, which you can export from Garrul's settings. Either way, removing the block from a page hides them on the site but doesn't delete them.
- **Moving a page starts a new discussion**, since pages are matched to their comments by their address. The old comments stay where they were, under the old address. Disqus can move them to the new address with the URL mapper in its migration tools.
- **Visitors' consent:** Giscus, Disqus and Garrul are other sites' content, so on a site that [asks visitors first](/docs/layout-and-settings#visitors-consent) the comments wait until a visitor agrees. Giscus keeps no data of its own about visitors; signing in to comment lets Giscus's app post comments for them on GitHub. See [Giscus's privacy policy](https://github.com/giscus/giscus/blob/main/PRIVACY-POLICY.md). Disqus sets its own cookies and shows ads based on what it knows about visitors; see [Disqus's privacy policy](https://disqus.com/privacy-policy/), and mention it in the site's own. Garrul keeps commenters' names, the email addresses of those who sign in, and a scrambled form of their computers' addresses in your own account, which makes you responsible for them, so mention it in the site's privacy policy too.
- **Garrul is a young project**, kept by one person and changing every week or so. Keep it up to date with its own instructions; the Comments block uses only what it shows on a page, which changes least.
- **Pages without JavaScript** show no comments with any of them, since all three load them in the visitor's browser.
- **Comments from WordPress** don't come across when [moving from WordPress](/docs/move-from-wordpress); they stay in WordPress.
