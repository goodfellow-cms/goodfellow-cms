---
version: 1
title: Put it online
description: Store the site on GitHub or GitLab, choose a host, and set up sign-in for editors.
section: start
order: 4
---

Setup takes four steps, done once by whoever sets up the site. A site made with the [setup page](/new-site) has done the first three, unless it's on Cloudflare Pages or Vercel, which you connect it to in step 3, so start at [step 4](#4-set-up-sign-in).

## 1. Store the site on GitHub or GitLab

Create an empty repository on GitHub or GitLab, without a README, and push the site's folder to it. If you're not sure which, we recommend GitLab, with GitLab Pages: see [Which to choose](/docs/hosts#which-to-choose).

```sh
git remote add origin https://github.com/your-name/your-site.git   # unless origin is already set
git push -u origin main
```

`create-goodfellow` makes the new site a git repository on the branch `main`, with everything, `package-lock.json` included, in its first commit, and sets `origin` when it's given the repository. Commit any changes since (`git add -A` and `git commit`) before pushing.

## 2. Tell Goodfellow where it's stored

If you gave the repository to `npm create goodfellow`, this is done. Otherwise, in `goodfellow.config.tsx`, uncomment one `backend` line and its `import`, and fill in the repository:

```tsx
import { github } from "@goodfellow-cms/github";

export default defineConfig({
  blocks,
  categories,
  backend: github({ repo: "your-name/your-site" }),
});
```

Builds include the admin panel at `/admin` only once a backend is set. If the live site is built from a branch other than the repository's default branch, add `branch: "name"`.

Then set the site's address under **Site Settings → General → Site address**, including any subfolder, such as `https://your-name.github.io/your-site`. It's used for the sitemap, link previews, feeds and what search engines are told about the site (see [Search engines and feeds](/docs/search-engines)); a site in a subfolder needs [its sitemap named](/docs/search-engines#sites-in-a-subfolder) where search engines look.

## 3. Choose a host

Each host's free plan has its own rules about business use; read [Hosts and business sites](/docs/hosts) first if the site is for a business, sells anything or shows ads.

**GitHub Pages**, free for public repositories:

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push. `.github/workflows/deploy.yml` builds and publishes the site on every change and once a night, and `.github/workflows/scheduled.yml` starts it when a [scheduled](/docs/scheduling) page or item comes due. If your main branch isn't called `main`, change it in `deploy.yml`.
3. If a run fails with "Branch … is not allowed to deploy to github-pages due to environment protection rules", GitHub Pages expects another branch. Under **Settings → Environments → github-pages → Deployment branches and tags**, add the branch the site is built from, then run **Deploy to GitHub Pages** again under **Actions**.

**GitLab Pages**, free for public and private projects:

1. Push. `.gitlab-ci.yml` builds and publishes the site on every change to the default branch.
2. For nightly rebuilds, add a schedule under **Build → Pipeline schedules**.
3. The site's address is under **Deploy → Pages**.

**Cloudflare Pages**, which works with GitHub and GitLab, including private repositories, and has no rule against business sites that we know of:

1. Make the site with Cloudflare Pages as its host: `npm create goodfellow@latest -- --host cloudflare-pages`, or choose it on the [setup page](/new-site). That gives it Cloudflare's setup files in place of the other hosts': on GitHub, `.github/workflows/deploy.yml` and `scheduled.yml`; on GitLab, `.gitlab-ci.yml`.
2. In [Cloudflare's dashboard](https://dash.cloudflare.com/), go to **Workers & Pages** and create a Pages project with **Import an existing Git repository**. Connect your GitHub or GitLab account, choose the repository, and set no framework preset, the build command `npm run build` and the build output directory `dist` (`out` for the Next.js starter). Cloudflare builds and publishes the site on every change, including every Publish in the admin panel, and sends the site's [redirects](/docs/layout-and-settings#redirects) itself.
3. Cloudflare can't build on a schedule, so the setup files do it: each night they install Goodfellow's [updates](/docs/updates), and they check for [scheduled changes](/docs/scheduling), asking Cloudflare to rebuild the site when there's nothing new for it to build. They ask through the project's deploy hook: under the project's **Settings → Builds**, add one for the main branch, and add its address to the repository as the `CLOUDFLARE_DEPLOY_HOOK` secret (GitHub: **Settings → Secrets and variables → Actions**) or masked variable (GitLab: **Settings → CI/CD → Variables**). On GitLab, turn on updates on the admin panel's **Updates** screen too, which adds the nightly schedule.

**Vercel**, which works with GitHub and GitLab:

1. Import the repository in Vercel. `vercel.ts` already has the right settings, and has Vercel send the site's redirects itself.
2. For nightly rebuilds, create a deploy hook under **Settings → Git → Deploy Hooks**, and call it from a scheduled GitHub Action or GitLab pipeline schedule.

Delete the setup files of the hosts you don't use. Nightly rebuilds keep pages that depend on the date, such as a list of upcoming events, current.

If the host serves the site from a subfolder, such as `/your-site/` on GitHub Pages, the setup files pass it to the build; see [Commands](/docs/commands) for the base path.

## 4. Set up sign-in

**GitHub:** editors sign in with an access token, created from a link that chooses the right permissions; see [Editors and sign-in](/docs/sign-in). For one-click **Sign in with GitHub**, run a [sign-in service](/docs/sign-in-service), name it in the site's config, and put the site's address in **Site settings**. The first time you sign in at `/admin`, the sign-in screen then offers to install the service's app on the repository, which signs you in too.

**GitLab:** editors can sign in with an access token straight away. For one-click **Sign in with GitLab**, register the admin panel with GitLab once:

1. Go to your profile's **Preferences → Applications** (or a group's **Settings → Applications**) and add an application.
2. Set the **Redirect URI** to the admin panel's address with a trailing slash, such as `https://your-site.example/admin/`, leave **Confidential** off, and choose the `api` scope.
3. Copy the **Application ID** into the config: `gitlab({ project: "your-name/your-site", clientId: "…" })`. If the site moves to a domain of its own later, add its new admin address as a redirect URI too.

Every editor needs permission to change the repository: on GitHub, write access; on GitLab, the Developer role or higher.

## Your own domain

To put the site at a domain of your own, such as `example.org`, connect it in the admin panel: see [Custom domains](/docs/custom-domains).
