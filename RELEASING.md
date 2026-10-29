# Releasing

Goodfellow's packages are released together, with one version number: every package in `packages/` is in one `fixed` group in `.changeset/config.json`, so a release publishes all of them, changed or not. The changes since the last release are the changesets in `.changeset/`.

## Every release

1. On an up-to-date `master`, make a branch and turn the changesets into changelogs and versions:

   ```sh
   git switch master && git pull
   git switch -c release
   pnpm release:version
   ```

   This runs `changeset version`, which bumps every package to the new version, adds the changesets to each package's `CHANGELOG.md` and deletes them. Read the changelogs, then commit (for example "Release 0.2.0"), push and open a pull request.

2. Merge it once CI passes. When CI then passes on `master`, the **Release** workflow (`.github/workflows/release.yml`):
   - stages every package npm doesn't have at the new version, with provenance. A staged version isn't published yet: nobody can install it until a maintainer approves it;
   - waits up to 5 hours for the approvals, checking npm every minute;
   - tags the release once every package is on npm: `v0.2.0`, and `<package>@0.2.0` for each package, as Changesets would;
   - deploys the docs site from the same commit (`.github/workflows/docs.yml`), so the docs describe the version on npm.

   Other changes to `master` don't change the versions, so the workflow finds nothing to publish and stops.

3. Approve the staged versions from your computer, with npm 11.15 or later (`npm install --global npm@11`) and signed in to npm (`npm login`):

   ```sh
   pnpm release:staged    # lists the versions waiting for approval
   pnpm release:approve   # shows them, asks, then approves each one
   ```

   Each staged version is listed with its digest, as npm gives it; the Release run that staged it lists the digest of each file it built, on its page, so compare them before approving. Approving publishes the packages, each after the packages it depends on. npm asks for your two-factor code or a browser sign-in for each one; `pnpm release:approve --otp 123456` gives it the code instead, while the code is still valid. If several versions are waiting, choose one with `--version 0.2.0`. To throw away a staged version instead, run `npm stage reject <id>` with the id `pnpm release:staged` shows.

Each Release run is for one commit: the one CI passed on, or master as it is when you start it from the Actions tab, which waits until CI has passed there. **Re-running** a run releases that run's own commit, so after merging the version pull request, re-running the run from before the merge says its version is already on npm; the merge's own run starts once CI passes on it. Each run's page says which commit it was for, and what it did.

If you approve after the workflow has stopped waiting, run the Release workflow again from the Actions tab: it finds every package on npm, tags the release and deploys the docs. However far master has moved on, the tags go on the commit where the release's version was set (the version pull request's merge), and the docs are built from it, so both describe what was published. If staging fails partway, run it again too: versions already on npm are skipped, and versions an earlier run staged can't be staged twice, so that step fails again for them but the workflow still waits for their approval.

## Publishing from your computer

`pnpm release:publish` does the same as the workflow from your computer, except that it publishes straight away, since you approve with your own two-factor code: it checks that you're on GitHub's latest `master` with nothing uncommitted and signed in to npm (`npm login`), runs lint, typecheck, tests and the build, shows what it will publish and asks before publishing. npm asks for a one-time code or a browser sign-in itself if your account needs one. `pnpm release:publish --dry-run` shows what would happen without publishing or tagging.

Afterwards, run **Deploy docs** in the Actions tab to update the docs site.

## Adding a package

A new published package goes in `.changeset/config.json`'s `fixed` group, so it shares every other package's version. Its first release can't come from the workflow: npm sets up trusted publishing in a package's settings, so the package has to exist on npm first, and the workflow stops with a message saying so. When it does:

1. On your computer, on GitHub's latest `master`, run `pnpm release:publish`. It publishes only the packages npm doesn't have at this version, which is just the new one.
2. Give the new package a trusted publisher as in [Setting up](#setting-up-once), with `npm trust github <package> --file release.yml --repo goodfellow-cms/goodfellow-cms --allow-stage-publish --yes`, and add it to the list there.
3. Run the **Release** workflow again from the Actions tab. npm now has every package, so it tags the release and deploys the docs.

`@goodfellow-cms/mcp` was added this way in 0.2.0, and `@goodfellow-cms/bitbucket` will be in its first release.

## The docs between releases

The docs site changes only with a release. To publish a fix to the docs sooner, run **Deploy docs** in the Actions tab with `master` as the version; leave the version empty to rebuild the latest release.

## Setting up (once)

1. **npm:** create the free organization `goodfellow-cms` at <https://www.npmjs.com/org/create>, so the `@goodfellow-cms` packages can be published. `goodfellow` and `create-goodfellow` aren't in the organization, but whoever publishes them first owns them.
2. **How the Release workflow signs in to npm.** Either:
   - **A token:** on npmjs.com, create a granular access token with read and write access to all packages and to the `goodfellow-cms` organization, allowed to publish without two-factor codes. Add it to the repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions). It works from the first release, but it's a long-lived secret that has to be renewed when it expires.
   - **Trusted publishing**, with no secret: npm sets it up in each package's settings, so each package has to exist first. Make the first release from your computer (merge the version pull request as usual: the workflow will fail at publishing, then run `pnpm release:publish`). Then, shortly before the next release, give each of the 12 packages a trusted publisher that may only stage versions, with npm 11.15 or later:

     ```sh
     for pkg in @goodfellow-cms/admin @goodfellow-cms/ai @goodfellow-cms/bitbucket @goodfellow-cms/blocks @goodfellow-cms/core \
       @goodfellow-cms/github @goodfellow-cms/gitlab @goodfellow-cms/mcp @goodfellow-cms/next \
       @goodfellow-cms/react @goodfellow-cms/registry goodfellow create-goodfellow; do
       npm trust github "$pkg" --file release.yml --repo goodfellow-cms/goodfellow-cms --allow-stage-publish --yes
     done
     ```

     `--allow-stage-publish` without `--allow-publish` means npm refuses `npm publish` from the workflow, so nothing reaches npm without a maintainer's approval. A package has only one trusted publisher: to replace one, such as one added for the repository's earlier owner, `chartung17` (npm matches the owner exactly), find its id with `npm trust list <package>` and remove it with `npm trust revoke --id <id> <package>` first. npm drops a trusted publisher that hasn't published within 2 days of being added. Once it works, npm recommends "Require two-factor authentication and disallow tokens" under each package's Settings → Publishing access.
3. **Make the repository public** (Settings → General → Danger Zone). GitHub Pages and npm's provenance need it to be.
4. **GitHub Pages:** in Settings → Pages, set **Source** to **GitHub Actions**. The docs are then at <https://goodfellow-cms.github.io/goodfellow-cms/>.
5. **The demo site** needs nothing: `docs.yml` builds it beside the docs, at <https://goodfellow-cms.github.io/goodfellow-cms/demo/admin/>, from the release's create-goodfellow with the published packages (`docs/scripts/demo.mjs`), and again every night, so its dates stay current and it picks up plugins' new releases.
6. **"Sign in with GitLab" on the setup page** (optional; without it, GitLab users paste a token): on gitlab.com, under **Edit profile → Applications** (or a group's **Settings → Applications**), add an application named Goodfellow, with the redirect URI `https://goodfellow-cms.github.io/goodfellow-cms/new-site/create/`, the setup page's second step, where people sign in, **Confidential** unchecked and the scope `api`. Put its **Application ID** (not the secret, which it doesn't need) in the Site setup block's `gitlabClientId` in `docs/content/pages/new-site/create.json`; it's public by design. (Done: Goodfellow's application is set there. Its first redirect URI was the first step's address, `…/new-site/`, before the page had two steps: keep it, so the published docs keep working until they're deployed with two steps, and add the new one on a line of its own.)
