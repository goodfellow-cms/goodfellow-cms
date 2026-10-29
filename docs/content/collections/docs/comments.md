---
version: 1
title: Comments
description: Let visitors comment on pages with the Comments block, which keeps their comments on GitHub through Giscus, and how to set it up.
section: owners
order: 1.5
---

A Goodfellow site has no server to keep comments on, so the **Comments** block keeps them on GitHub instead, through [Giscus](https://giscus.app), a free service. Each page's comments are a discussion in a GitHub repository you choose: anyone can read them, and visitors sign in with GitHub to write one or react to the page. You look after them on GitHub, where you can hide, delete and lock them.

Comments is a block from Goodfellow's block registry, so it's added on the **Blocks** screen; see [Add blocks](/docs/add-blocks). Setting it up takes about ten minutes, and needs a GitHub account. A site on GitLab or Bitbucket can use it too, since the comments' repository is separate from the site's.

## Set it up

### 1. Make a repository for the comments

Comments are kept in a repository's Discussions, which visitors must be able to see, so the repository has to be public. Your site's own repository works if it's public, but one of its own keeps comments apart from the site's files and works whether the site's is public or not.

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

Giscus can then start a discussion for each page that gets its first comment, and post visitors' comments in it as them.

### 4. Copy Giscus's code

1. Open [giscus.app](https://giscus.app).
2. Under **Repository**, type the repository's owner and name, such as `stjoseph/website-comments`. Giscus says when it's ready; if it doesn't, check the three steps above.
3. Under **Discussion Category**, choose **Announcements**. Only Giscus and the repository's owners can start discussions in it, so nobody can start one by hand.
4. Leave the other choices as they are: the block sets them itself, matching each page by its address and following the site's language and dark mode.
5. Under **Enable giscus**, copy the code, which starts with `<script src="https://giscus.app/client.js"`.

### 5. Add the block

1. On the **Blocks** screen, add **Comments** and publish. The editor offers the block once the site has been rebuilt, a minute or two later.
2. Open a page, or a [collection's page design](/docs/collections) to have comments under every item, such as every news story.
3. Add the **Comments** block where the comments should go, and paste the code into **Giscus's code**.
4. Publish.

The editor shows a note where the comments will be, rather than the comments themselves, since Giscus loads only on the published site. Open the page on the site to see it.

## Choices

- **Heading** shows above the comments. Leave it empty for none.
- **Reactions to the page** shows or hides the row of reactions, such as 👍 and ❤️, above the comments.
- **Box for writing a comment** puts it above the comments or under them.

## Looking after comments

Every page with comments has a discussion in the repository's **Discussions** tab, named after the page's address, such as `news/parish-fair`. GitHub emails the repository's owners about new comments, as it does for any discussion; choose what you're told about with the repository's **Watch** button.

- **Hide or delete a comment:** open the discussion, then the comment's **…** menu. Hiding folds it away with a reason, such as spam or off-topic, rather than deleting it.
- **Stop comments on a page:** open its discussion and choose **Lock conversation**.
- **Keep someone out:** in your account's or organization's **Settings**, under **Moderation**, block them.
- **Pause comments for a while:** in the repository's **Settings**, under **Moderation options**, limit who can comment.

## Things to know

- **Visitors need a GitHub account to comment**, though not to read. Many people without one won't comment, so the block suits sites whose visitors are likely to have one, or where a few comments are enough.
- **Comments are public on GitHub**, with the commenters' names, and stay in the repository however the site changes. Removing the block from a page hides them on the site but doesn't delete them.
- **Moving a page starts a new discussion**, since pages are matched to discussions by their address. The old comments stay in the old discussion on GitHub.
- **Visitors' consent:** Giscus is another site's content, so on a site that [asks visitors first](/docs/layout-and-settings#visitors-consent) the comments wait until a visitor agrees. Giscus keeps no data of its own about visitors; signing in to comment lets Giscus's app post comments for them on GitHub. See [Giscus's privacy policy](https://github.com/giscus/giscus/blob/main/PRIVACY-POLICY.md).
- **Comments from WordPress** don't come across when [moving from WordPress](/docs/move-from-wordpress); they stay in WordPress.
