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

   Approving publishes the packages, each after the packages it depends on. npm asks for your two-factor code or a browser sign-in for each one; `pnpm release:approve --otp 123456` gives it the code instead, while the code is still valid. If several versions are waiting, choose one with `--version 0.2.0`. To throw away a staged version instead, run `npm stage reject <id>` with the id `pnpm release:staged` shows.

If you approve after the workflow has stopped waiting, run the Release workflow again from the Actions tab: it finds every package on npm, tags the release and deploys the docs. If staging fails partway, run it again too: versions already on npm are skipped, and versions an earlier run staged can't be staged twice, so that step fails again for them but the workflow still waits for their approval.

## Publishing from your computer

`pnpm release:publish` does the same as the workflow from your computer, except that it publishes straight away, since you approve with your own two-factor code: it checks that you're on GitHub's latest `master` with nothing uncommitted and signed in to npm (`npm login`), runs lint, typecheck, tests and the build, shows what it will publish and asks before publishing. npm asks for a one-time code or a browser sign-in itself if your account needs one. `pnpm release:publish --dry-run` shows what would happen without publishing or tagging.

Afterwards, run **Deploy docs** in the Actions tab to update the docs site.

## The docs between releases

The docs site changes only with a release. To publish a fix to the docs sooner, run **Deploy docs** in the Actions tab with `master` as the version; leave the version empty to rebuild the latest release.

## Setting up (once)

1. **npm:** create the free organization `goodfellow-cms` at <https://www.npmjs.com/org/create>, so the `@goodfellow-cms` packages can be published. `goodfellow` and `create-goodfellow` aren't in the organization, but whoever publishes them first owns them.
2. **How the Release workflow signs in to npm.** Either:
   - **A token:** on npmjs.com, create a granular access token with read and write access to all packages and to the `goodfellow-cms` organization, allowed to publish without two-factor codes. Add it to the repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions). It works from the first release, but it's a long-lived secret that has to be renewed when it expires.
   - **Trusted publishing**, with no secret: npm sets it up in each package's settings, so each package has to exist first. Make the first release from your computer (merge the version pull request as usual: the workflow will fail at publishing, then run `pnpm release:publish`). Then, shortly before the next release, give each of the 11 packages a trusted publisher that may only stage versions, with npm 11.15 or later:

     ```sh
     for pkg in @goodfellow-cms/admin @goodfellow-cms/ai @goodfellow-cms/blocks @goodfellow-cms/core \
       @goodfellow-cms/github @goodfellow-cms/gitlab @goodfellow-cms/next @goodfellow-cms/react \
       @goodfellow-cms/registry goodfellow create-goodfellow; do
       npm trust github "$pkg" --file release.yml --repo goodfellow-cms/goodfellow-cms --allow-stage-publish --yes
     done
     ```

     `--allow-stage-publish` without `--allow-publish` means npm refuses `npm publish` from the workflow, so nothing reaches npm without a maintainer's approval. A package has only one trusted publisher: to replace one, such as one added for the repository's earlier owner, `chartung17` (npm matches the owner exactly), find its id with `npm trust list <package>` and remove it with `npm trust revoke --id <id> <package>` first. npm drops a trusted publisher that hasn't published within 2 days of being added. Once it works, npm recommends "Require two-factor authentication and disallow tokens" under each package's Settings → Publishing access.
3. **Make the repository public** (Settings → General → Danger Zone). GitHub Pages and npm's provenance need it to be.
4. **GitHub Pages:** in Settings → Pages, set **Source** to **GitHub Actions**. The docs are then at <https://goodfellow-cms.github.io/goodfellow-cms/>.
5. **The demo site** lives in a repository of its own, `goodfellow-cms/goodfellow-demo`, made from the parish example with the published packages; the docs' [Demo mode](docs/content/collections/docs/demo-mode.md) page has the steps. The docs and README link to <https://goodfellow-cms.github.io/goodfellow-demo/admin/>, so use that name, or change the links.
6. **"Sign in with GitLab" on the setup page** (optional; without it, GitLab users paste a token): on gitlab.com, under **Edit profile → Applications** (or a group's **Settings → Applications**), add an application named Goodfellow, with the redirect URI `https://goodfellow-cms.github.io/goodfellow-cms/new-site/`, **Confidential** unchecked and the scope `api`. Put its **Application ID** (not the secret, which it doesn't need) in the Site setup block's `gitlabClientId` in `docs/content/pages/new-site.json`; it's public by design. (Done: Goodfellow's application is set there.)
