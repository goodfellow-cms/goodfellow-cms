---
version: 1
title: Keeping a site up to date
description: How sites install Goodfellow's fixes each night, how owners choose newer releases, and how to go back if an update breaks something.
section: owners
order: 5
---

Goodfellow gets fixes and new releases. Sites made from a starter install fixes on their own each night, and only once they've checked that the site still builds with them. **Site Settings → Updates** in the admin panel shows the site's release, what it can update to, and how the last update went.

## How updates work

Each night, the site's build on GitHub Pages or GitLab Pages first runs `goodfellow update`:

1. It finds the newest fix for the site's release on npm: for a site on 0.4.1, the newest 0.4 release. Releases that can change how things work, such as 0.5, are only installed when an owner chooses one. Nothing is installed if automatic fixes are turned off, and releases the site went back from are left out.
2. It updates every Goodfellow package to it, and the version of Puck that release uses.
3. It updates blocks added from Goodfellow's block registry. A block's files that someone changed since they were added stay as they are, and the Updates screen lists them, so nobody's changes are lost.
4. It installs the packages and builds the site. If either fails, every file goes back as it was, and the site is built as it was before.
5. If the site built, the update is published as one change, named "Update Goodfellow to …", which the site's version history shows.

The rest of the build then puts the site online as usual, with the update if it worked.

Where the site's [content is kept in a repository of its own](/docs/content-repository), updates run in the code's repository instead, and the Updates screen follows them there, for people who can see it, when the config names the code repository.

## The Updates screen

- **Fixes:** when fixes are ready, **Install fixes now** installs them without waiting for the night.
- **Newer releases:** when a newer release is out, owners see **Update to …**, with a link to what's new. Read it first: a newer release can change how some things work.
- **Install fixes automatically each night:** owners can turn this off to keep the site on the release it has, for example while something an update changed is looked into. Fixes are then only installed with **Install fixes now**.
- **Something stopped working?** Owners see **Go back to …**, which installs the release the site had before, as an update does: the site is checked to still build with it, and going back is published as one change, named "Go back to Goodfellow …". The release it went back from is skipped from then on, so the nightly update won't install it again, but it will install fixes that come after it.
- **Releases that won't be installed:** the releases the site went back from. **Allow … again** lets updates install one again.
- **Last update:** when the last update ran and what it did. If it didn't work, it says why: for example, the site didn't build with it, in which case a developer may need to look at the details.

These settings are kept in `content/updates.json`, so changing one is published like any other change, and shows in the site's version history.

On GitHub, installing an update or going back from the screen runs the site's workflow, which needs an owner's sign-in or [owner token](/docs/sign-in#inviting-and-removing-editors), which the screen asks for. Either can run workflows.

## Turning it on

- **GitHub Pages:** the starter's workflow, `.github/workflows/deploy.yml`, updates the site each night already.
- **GitLab Pages:** GitLab needs two things first, which **Turn on automatic updates** on the Updates screen does: letting the site's build publish (**Allow Git push requests to the repository**, under **Settings → CI/CD → Job token permissions**, which GitLab offers from release 18.4), and a pipeline schedule that runs the build each night. It needs the Maintainer role in the site's project.
- **Older sites, and sites on Vercel:** their build setup doesn't update Goodfellow, so the Updates screen says so. A developer can copy the `update` job from the starter's `deploy.yml`, or the update step from its `.gitlab-ci.yml`, or run `npx goodfellow update` and publish the result.

## For developers

`goodfellow update` (or `goodfellow-next update` in a Next.js site) updates the site in its folder:

- `--to fixes`, the default, installs the newest fix for the site's release; `--to automatic` does the same unless `content/updates.json` turns automatic fixes off, which is what the nightly build runs; `--to latest` installs the newest release; `--to 0.5.0` a release itself. `fixes`, `automatic` and `latest` leave out the releases `content/updates.json` skips.
- An older release, such as `--to 0.4.1` on a site with 0.4.3, goes back to it, and adds 0.4.3 to the releases `content/updates.json` skips, in the same change. Installing a skipped release by name stops skipping it.
- `--publish` commits and pushes the update to the site's main branch once the site has built with it. Without it, the files are left changed for you to look at.
- It prints a line starting `goodfellow-update`, which the admin panel reads in GitLab's log, and exits with an error when the update didn't work.
