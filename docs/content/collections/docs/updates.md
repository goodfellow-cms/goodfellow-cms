---
version: 1
title: Keeping a site up to date
description: How sites install Goodfellow's fixes and rebuild overnight only when something changed, how owners choose newer releases and rebuild now, and how to go back if an update breaks something.
section: owners
order: 5
---

Goodfellow gets fixes and new releases. Sites made from a starter install fixes on their own overnight, and only once they've checked that the site still builds with them. **Site Settings → Updates** in the admin panel shows the site's release, what it can update to, how the last update went, and when the site rebuilds overnight.

## Rebuilding overnight

Free plans count build minutes and builds, so each night the site is rebuilt only when visitors would see something new. A short check, `goodfellow nightly`, rebuilds it when:

- Goodfellow has fixes the site's settings allow, which it installs first, as below;
- something the site shows by today's date has changed since it was built: an event's next date, a calendar's upcoming events or today on a month at a time, a list of what's coming up, or a page scheduled to be shown or hidden. A calendar that shows [another calendar's events](/docs/calendars#calendars-kept-elsewhere) counts as changed every night, since its changes can't be known ahead, as does a [News feed](/docs/add-blocks) block;
- the live site isn't the newest build, such as after one that didn't work, or the check can't tell, because the live site can't be read.

Every build writes `goodfellow-build.json` beside the site, saying what it was built from and when what it shows next changes, which is how the check knows. On GitHub, the [hourly check for scheduled changes](/docs/scheduling) also rebuilds the site the first hour after that time, so dates go current within the hour.

**Rebuilding overnight** on the Updates screen lets owners choose:

- **Only when something changed**, the default.
- **Every night**, as sites did before.
- **Never**, which saves the most, but what the site shows by today's date goes out of date, and fixes aren't installed on their own. Publishing still rebuilds the site, and so does **Rebuild now**.

On GitHub the choice is kept in a repository variable, `GOODFELLOW_NIGHTLY`, which the workflow's jobs read before they start, so a night that's off uses no minutes; changing it needs an owner's sign-in or owner token, which the screen asks for. On GitLab, **Never** turns the nightly pipeline schedule off, and **Every night** gives it the `GOODFELLOW_NIGHTLY` variable. On Bitbucket, **Never** turns the nightly pipeline schedule off, and **Every night** sets the `GOODFELLOW_NIGHTLY` repository variable. GitLab Pages needs a pages job to publish something, so on nights with nothing new the job publishes the live site's files again rather than building it.

## Rebuild now

Owners can rebuild the site from the Updates screen without publishing anything, with **Rebuild now**: for a site that doesn't rebuild overnight, to catch up with another calendar's events, or after a rebuild that didn't work. The admin panel follows it as it follows a publish. On GitHub it runs the site's workflow, which needs an owner's sign-in or owner token; on GitLab it starts a pipeline with `GOODFELLOW_REBUILD` set, which only builds the site. On Bitbucket it runs the `update` pipeline with `GOODFELLOW_REBUILD` set. Sites on Cloudflare Pages, and sites on Bitbucket, which Vercel builds, rebuild through their deploy hook, from the same workflow or pipeline.

## How updates work

When there are fixes to install, the site's build first runs `goodfellow update`:

1. It finds the newest fix for the site's release on npm: for a site on 0.4.1, the newest 0.4 release. Releases that can change how things work, such as 0.5, are only installed when an owner chooses one. Nothing is installed if automatic fixes are turned off, and releases the site went back from are left out.
2. It updates every Goodfellow package to it, and the version of Puck that release uses. It also adds the `overrides` new sites' `package.json` has, which replace packages Goodfellow's dependencies bring in with releases that fix their security advisories, so `npm audit` doesn't list them.
3. It updates blocks added from Goodfellow's block registry. A block's files that someone changed since they were added stay as they are, and the Updates screen lists them, so nobody's changes are lost.
4. It installs the packages, taking only what npm had a day after the release came out, so a package someone published, or took over, since then isn't installed into the site overnight, and builds the site. If either fails, every file goes back as it was, and the site is built as it was before.
5. If the site built, the update is published as one change, named "Update Goodfellow to …", which the site's version history shows.

On GitHub, the job that installs the update and builds the site can only read the repository, so packages it installs can't publish anything. A second job, which runs none of the site's code, publishes the change the first one made, and only if it changes nothing but what an update does (`package.json`, `package-lock.json`, `content/updates.json`, the starter's own files a release brings and installed blocks' code) and takes every new package from npm's registry, since the first job ran the site's code, which could have changed anything. On GitLab, any job in the site's project can publish once updates are turned on, since GitLab gives every job the same permissions. Bitbucket lets every pipeline step publish, as GitLab does.

The rest of the build then puts the site online as usual, with the update if it worked.

Where the site's [content is kept in a repository of its own](/docs/content-repository), updates run in the code's repository instead, and the Updates screen follows them there, for people who can see it, when the config names the code repository.

## The Updates screen

- **Fixes:** when fixes are ready, **Install fixes now** installs them without waiting for the night.
- **Newer releases:** when a newer release is out, owners see **Update to …**, with a link to what's new. Read it first: a newer release can change how some things work. If the site's [theme](/docs/themes) doesn't say it works with that release, the screen says so, so you can check for a newer version of the theme first.
- **Install fixes automatically each night:** owners can turn this off to keep the site on the release it has, for example while something an update changed is looked into. Fixes are then only installed with **Install fixes now**.
- **Something stopped working?** Owners see **Go back to …**, which installs the release the site had before, as an update does: the site is checked to still build with it, and going back is published as one change, named "Go back to Goodfellow …". The release it went back from is skipped from then on, so the nightly update won't install it again, but it will install fixes that come after it.
- **Releases that won't be installed:** the releases the site went back from. **Allow … again** lets updates install one again.
- **Last update:** when the last update ran and what it did. If it didn't work, it says why: for example, the site didn't build with it, in which case a developer may need to look at the details.

These settings are kept in `content/updates.json`, so changing one is published like any other change, and shows in the site's version history.

On GitHub, installing an update or going back from the screen runs the site's workflow, which needs an owner's sign-in or [owner token](/docs/sign-in#inviting-and-removing-editors), which the screen asks for. Either can run workflows.

## Turning it on

- **GitHub Pages:** the starter's workflow, `.github/workflows/deploy.yml`, checks each night already.
- **GitLab Pages:** GitLab needs two things first, which **Turn on automatic updates** on the Updates screen does: letting the site's build publish (**Allow Git push requests to the repository**, under **Settings → CI/CD → Job token permissions**, which GitLab offers from release 18.4), and a pipeline schedule that runs the check each night. It needs the Maintainer role in the site's project.
- **Cloudflare Pages:** a site made with Cloudflare Pages as its host has the same nightly check in its own setup files: on GitHub, `.github/workflows/deploy.yml`, which asks Cloudflare to rebuild the site through its deploy hook when it needs rebuilding and there's no update to publish; on GitLab, `.gitlab-ci.yml`, which **Turn on automatic updates** sets up as for GitLab Pages.
- **Bitbucket:** a site on Bitbucket has the nightly check in `bitbucket-pipelines.yml`, as the `update` pipeline, which asks Vercel to rebuild the site through its deploy hook when it needs rebuilding and there's no update to publish. **Turn on automatic updates** turns on Pipelines and adds a schedule that runs it each night (**Pipelines → Schedules**), which needs the Admin permission. Each check takes about a minute of the 50 build minutes Bitbucket's free plan has each month.
- **Sites made before the nightly check:** their setup files rebuild the site every night, and keep working; the Updates screen says so, in place of the choice. A developer can copy the starter's `deploy.yml` or `.gitlab-ci.yml` over theirs, since updates can't change a site's workflows. Sites whose [content is kept in a repository of its own](/docs/content-repository) rebuild every night for now.
- **Older sites, and sites on Vercel from GitHub or GitLab:** their build setup doesn't update Goodfellow, so the Updates screen says so. A developer can copy the `check`, `update` and `publish-update` jobs from the starter's `deploy.yml`, or its `.gitlab-ci.yml`, or run `npx goodfellow update` and publish the result.

## For developers

`goodfellow update` (or `goodfellow-next update` in a Next.js site) updates the site in its folder:

- `--to fixes`, the default, installs the newest fix for the site's release; `--to automatic` does the same unless `content/updates.json` turns automatic fixes off, which is what the nightly build runs; `--to latest` installs the newest release; `--to 0.5.0` a release itself. `fixes`, `automatic` and `latest` leave out the releases `content/updates.json` skips. A new minor release, such as 0.8.0 for a site on 0.7.x, is never a fix: when it's the only newer one, `goodfellow update` says so, and `--to latest` installs it.
- An older release, such as `--to 0.4.1` on a site with 0.4.3, goes back to it, and adds 0.4.3 to the releases `content/updates.json` skips, in the same change. Installing a skipped release by name stops skipping it.
- `--publish` commits and pushes the update to the site's main branch once the site has built with it. `--commit` only commits it, so a job that can't push can make it and another job, which runs none of the site's code, can push it, as the starter's workflow does; in GitHub Actions it sets the step's `commit` output to `true` when it made one. Without either, the files are left changed for you to look at.
- It prints a line starting `goodfellow-update`, which the admin panel reads in GitLab's log, and exits with an error when the update didn't work.

`goodfellow nightly` (or `goodfellow-next nightly`) says whether tonight's build is needed, and why, reading the live site's `goodfellow-build.json` from the Site address. `--mode`, or the `GOODFELLOW_NIGHTLY` variable, is `changed` (the default), `always` or `off`. In GitHub Actions it sets the step's `build` and `update` outputs to `true` or `false`; `--output <file>` adds them to a file instead, which the GitLab and Bitbucket setups read in their shell.
