---
version: 1
title: Upgrading an older site
description: What the nightly update changes and what it leaves alone, how to bring an older site's setup files up to date, Next.js sites' own files, content files from other releases, going back, and where to read what changed in each release.
section: owners
order: 5.1
---

Most sites never need this page: [updates](/docs/updates) install Goodfellow's fixes overnight, and owners choose newer releases on the Updates screen. This page is for what updates can't do by themselves, and for developers bringing an older site up to date.

## What updates change

An update, from the Updates screen, overnight or with `goodfellow update`, changes:

- every Goodfellow package in `package.json`, and the release of Puck it uses, with `package-lock.json`;
- the `overrides` in `package.json` that new sites have, which move packages with security advisories to their fixed releases;
- blocks added from Goodfellow's block registry, apart from files someone has changed since, which it lists and leaves as they are;
- the site's own files a release brings or changes, such as a Next.js site's admin page, but only where they're still exactly as an earlier release wrote them;
- `content/updates.json`, when it goes back from a release.

It doesn't change:

- **The site's GitHub workflows,** `.github/workflows/`, since the job that publishes the update can't change them, by GitHub's rules. Older sites keep the setup they were made with, which keeps working.
- **Other setup files** that a release changed: `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `vercel.ts`, `.npmrc` and the rest, so a change someone made to them is never lost.
- **Files you've changed,** including the site's config, `goodfellow.config.tsx`, your own blocks, and registry blocks' files someone edited.
- **Content,** which every release reads as it was saved (see [Content files from other releases](#content-files-from-other-releases)).
- **Themes and plugins,** which change only when an owner chooses a newer version ([Themes](/docs/themes#updates), [Plugins](/docs/plugins)).

When a release brings something only newer setup files have, such as [rebuilding overnight only when something changed](/docs/updates#rebuilding-overnight), the hourly check for [scheduled pages](/docs/scheduling) on GitHub, or [plugins' tasks](/docs/plugins#tasks), the site carries on as before, and the screens that use it say where the site's setup doesn't have it yet, such as the Updates screen for rebuilding overnight.

## Bringing setup files up to date

To give an older site the newest setup, a developer copies the newer files over the site's own:

1. Make a site with the same choices in another folder, with the release the site now has, so the files match its packages: `npm create goodfellow@<release> new-copy -- --template starter --github your-name/your-site --host github-pages --no-install --no-git`, with the site's own template (`next` for a Next.js site), host and where it's stored ([Create a site](/docs/create-a-site#with-create-goodfellow)). This writes the setup files for hosts that have their own, such as Cloudflare Pages and Bitbucket, with the options filled in, which the starter in the repository doesn't have.
2. Compare its setup files with the site's: `.github/workflows/` (`deploy.yml`, `scheduled.yml` and `plugin-task.yml`), `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `vercel.ts` or a Next.js site's `vercel.json`, and `.npmrc`. Keep anything the site's developers added on purpose, such as a different branch or build command, and take the rest.
3. Publish the change, which on GitHub needs a token or sign-in that can change workflows, and check the next build on the host.

A site whose [content is kept in a repository of its own](/docs/content-repository) has setup files in both repositories, which create-goodfellow's `--content` option writes the same way. A site made for one host and moved to another needs the new host's files instead ([Put it online](/docs/put-it-online#3-choose-a-host)).

What each setup file does is described where it's used: [Keeping a site up to date](/docs/updates#turning-it-on) for the nightly check and update, [Scheduling](/docs/scheduling) for the hourly check, and [Plugins](/docs/plugins#tasks) for tasks.

## Next.js sites

A Next.js site's own routes are files in its `app/` folder, which the site's developers may change, so `goodfellow-next update` brings up to date only the ones a release changed and that are still exactly as an earlier release wrote them, such as `app/admin/page.tsx` and `app/admin/editor/page.tsx` for the editor's frames, and `vercel.json`. One someone changed is left alone, and the admin panel says how to update it where it needs to be: compare it with the same file in a new copy made with `--template next`, as in [Bringing setup files up to date](#bringing-setup-files-up-to-date). The [Next.js](/docs/nextjs) page says what each route is for. Keep `goodfellow-next finish` in the build script.

## Content files from other releases

Every content file has a `version`, so a release that changes how something is stored can still read files saved before it, upgrading them as it reads them, and the admin panel saves them in the new form the next time they're published. Nothing needs doing by hand, and a site going back to an older release keeps reading the files it hasn't changed since.

A release never reads files saved by a newer one, since it can't know what they mean: the build and the admin panel stop with "was saved by a newer version of Goodfellow", naming the file. That happens when someone edits the site with a newer release on their computer than the site has, or after going back to an older release. Update the site to that release, or put the file back from its version history.

## Going back

If an update breaks something, **Go back to …** on the Updates screen installs the release the site had before, checks that the site builds with it, and skips the newer release from then on ([The Updates screen](/docs/updates#the-updates-screen)). Developers can do the same with `goodfellow update --to <release>` ([For developers](/docs/updates#for-developers)). Going back leaves setup files and content as they are, and files the admin panel saved in a newer form while the newer release was installed stop the older one, as above.

## Themes and plugins

Themes and plugins say which releases of Goodfellow they work with. The Updates screen warns before an update to a release outside an installed theme's or plugin's range, so an owner can look for a newer version of it first. Update the theme on the [Themes](/docs/themes#updates) screen, and plugins on the [Plugins](/docs/plugins#install-a-plugin-from-the-admin-panel) screen, before or after the site, as their ranges allow.

## What changed in each release

Every Goodfellow package is released together, with the same version, and each release's changes are in the packages' changelogs:

- [`@goodfellow-cms/core`](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/packages/core/CHANGELOG.md): content files, checks, updates and most of what sites do;
- [`@goodfellow-cms/admin`](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/packages/admin/CHANGELOG.md): the admin panel;
- [`@goodfellow-cms/blocks`](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/packages/blocks/CHANGELOG.md): the built-in blocks;
- [`goodfellow`](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/packages/cli/CHANGELOG.md) and [`@goodfellow-cms/next`](https://github.com/goodfellow-cms/goodfellow-cms/blob/master/packages/next/CHANGELOG.md): building sites, and Next.js sites.

The Updates screen links to what's new in a release before an owner installs it. Read the changes between the site's release and the new one: a new minor release, such as 0.9 after 0.8, can change how things work, and says what to do where something needs doing.
