---
version: 1
title: Put it online
description: Store the site on GitHub, GitLab or Bitbucket, choose a host, and set up sign-in for editors.
section: start
order: 4
---

Setup takes four steps, done once by whoever sets up the site. A site made with the [setup page](/new-site) has done the first three, unless it's on Cloudflare Pages, Netlify or Vercel, which you connect it to in step 3, so start at [step 4](#4-set-up-sign-in).

## 1. Store the site on GitHub, GitLab or Bitbucket

Create an empty repository on GitHub, GitLab or Bitbucket Cloud, without a README, and push the site's folder to it. If you're not sure which, we recommend GitLab, with GitLab Pages: see [Which to choose](/docs/hosts#which-to-choose). A site stored on Bitbucket is put online by Vercel, so make it with `npm create goodfellow@latest -- --bitbucket your-workspace/your-site`, which gives it the setup Bitbucket needs.

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

These five have setup files ready. A site can be hosted anywhere else too, such as on AWS, Google Cloud, DigitalOcean or a server of your own, with a build you set up: see [Host anywhere](/docs/any-host).

**GitHub Pages**, free for public repositories:

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push. `.github/workflows/deploy.yml` builds and publishes the site on every change, and each night when something has changed or there are [fixes](/docs/updates) to install, and `.github/workflows/scheduled.yml` starts it when a [scheduled](/docs/scheduling) page or item comes due. If your main branch isn't called `main`, change it in `deploy.yml`.
3. If a run fails with "Branch … is not allowed to deploy to github-pages due to environment protection rules", GitHub Pages expects another branch. Under **Settings → Environments → github-pages → Deployment branches and tags**, add the branch the site is built from, then run **Deploy to GitHub Pages** again under **Actions**.

**GitLab Pages**, free for public and private projects:

1. Push. `.gitlab-ci.yml` builds and publishes the site on every change to the default branch.
2. For updates and overnight rebuilds, turn on updates on the admin panel's **Updates** screen, which adds a nightly schedule under **Build → Pipeline schedules**.
3. The site's address is under **Deploy → Pages**.

**Cloudflare Pages**, which works with GitHub and GitLab, including private repositories, and has no rule against business sites that we know of:

1. Make the site with Cloudflare Pages as its host: `npm create goodfellow@latest -- --host cloudflare-pages`, or choose it on the [setup page](/new-site). That gives it Cloudflare's setup files in place of the other hosts': on GitHub, `.github/workflows/deploy.yml` and `scheduled.yml`; on GitLab, `.gitlab-ci.yml`.
2. In [Cloudflare's dashboard](https://dash.cloudflare.com/), go to **Workers & Pages** and create a Pages project with **Import an existing Git repository**. Connect your GitHub or GitLab account, choose the repository, and set no framework preset, the build command `npm run build` and the build output directory `dist` (`out` for the Next.js starter). Cloudflare builds and publishes the site on every change, including every Publish in the admin panel, and sends the site's [redirects](/docs/layout-and-settings#redirects) itself. Under the project's **Settings → Builds → Branch control**, set preview branches to **None**: [drafts](/docs/publishing#drafts), and the answers of plugins' [tasks](/docs/plugins#tasks), are kept on branches of their own, which Cloudflare would otherwise build too.
3. Cloudflare can't build on a schedule, so the setup files do it: each night they install Goodfellow's [updates](/docs/updates) and check whether the site needs rebuilding, and they check for [scheduled changes](/docs/scheduling), asking Cloudflare to rebuild the site when it needs it and there's nothing new for it to build. They ask through the project's deploy hook: under the project's **Settings → Builds**, add one for the main branch, and add its address to the repository as the `CLOUDFLARE_DEPLOY_HOOK` secret (GitHub: **Settings → Secrets and variables → Actions**) or masked variable (GitLab: **Settings → CI/CD → Variables**). On GitLab, turn on updates on the admin panel's **Updates** screen too, which adds the nightly schedule.

**Netlify**, which works with GitHub and GitLab, including private repositories, and has no rule against business sites that we know of, but whose free plan allows about 20 publishes a month ([Netlify](/docs/hosts#netlify)):

1. Make the site with Netlify as its host: `npm create goodfellow@latest -- --host netlify`, or choose it on the [setup page](/new-site). That gives it `netlify.toml`, Netlify's settings, and the nightly setup files in place of the other hosts': on GitHub, `.github/workflows/deploy.yml` and `scheduled.yml`; on GitLab, `.gitlab-ci.yml`.
2. In [Netlify](https://app.netlify.com/start), choose **Import an existing project**, connect your GitHub or GitLab account and choose the repository. `netlify.toml` already has the build command, the folder Netlify publishes (`dist`, or `out` for the Next.js starter) and Node.js 22, and has Netlify skip [drafts](/docs/publishing#drafts) and plugins' [task](/docs/plugins#tasks) answers, which are kept on branches of their own, so their previews never build with the site's environment variables. Netlify builds and publishes the site on every change, and sends its [redirects](/docs/layout-and-settings#redirects) and [safer headers](/docs/security#for-developers) itself.
3. Netlify can't build on a schedule, so the setup files do it, as for Cloudflare Pages: under the site's **Project configuration → Build & deploy → Build hooks**, add a build hook for the main branch, and add its address to the repository as the `NETLIFY_BUILD_HOOK` secret (GitHub) or masked variable (GitLab). On GitLab, turn on updates on the admin panel's **Updates** screen too, which adds the nightly schedule.

A site whose content is kept in a [repository of its own](/docs/content-repository) can't be on Netlify yet.

**Vercel**, which works with GitHub, GitLab and Bitbucket:

1. Import the repository in Vercel. `vercel.ts` already has the right settings: it has Vercel send the site's redirects and [safer headers](/docs/security#for-developers) itself, and not build previews of [drafts](/docs/publishing#drafts) or plugins' [task](/docs/plugins#tasks) answers, which are kept on branches of their own. The Next.js starter has `vercel.json` instead, which only turns those previews off, since Next.js sends the rest itself; sites made from it before Goodfellow 0.9 get it with their next update.
2. For nightly rebuilds, create a deploy hook under **Settings → Git → Deploy Hooks**, and call it from a scheduled GitHub Action or GitLab pipeline schedule. Sites stored on Bitbucket have this set up already (see below).

**Bitbucket**, whose sites Vercel builds: Bitbucket's own static websites have one address for each workspace and no domains of their own, and Cloudflare Pages doesn't build from Bitbucket. `create-goodfellow --bitbucket` gives the site `bitbucket-pipelines.yml`, in which Bitbucket Pipelines run the nightly [update](/docs/updates), the check for [scheduled changes](/docs/scheduling), and plugins' [tasks](/docs/plugins#tasks), and writes `package-lock.json` when a plugin is installed. To set it up:

1. Import the repository in Vercel, as above, and under the project's **Settings → Git → Deploy Hooks** create a hook for the main branch.
2. In the repository on Bitbucket, turn Pipelines on under **Repository settings → Pipelines → Settings**, and under **Repository settings → Pipelines → Repository variables** add the hook's address as `VERCEL_DEPLOY_HOOK`, with **Secured** ticked.
3. In the admin panel, turn on updates on the **Updates** screen, which adds the nightly schedule under **Pipelines → Schedules**. That needs the repository's Admin permission.
4. Scheduled changes then go live at their time: the admin panel adds a schedule for each, which runs the `scheduled` pipeline once, and removes it once it has passed. That needs the Admin permission too, so an editor's scheduled change waits for the nightly rebuild unless an owner opens the admin panel before then.

Bitbucket gives every pipeline step the repository's variables and lets it publish, so keep only what the site needs there.

Delete the setup files of the hosts you don't use. Overnight rebuilds keep pages that depend on the date, such as a list of upcoming events, current; the starters' setups rebuild only when something changed ([Rebuilding overnight](/docs/updates#rebuilding-overnight)).

If the host serves the site from a subfolder, such as `/your-site/` on GitHub Pages, the setup files pass it to the build; see [Commands](/docs/commands) for the base path.

## 4. Set up sign-in

**GitHub:** editors sign in with an access token, created from a link that chooses the right permissions; see [Editors and sign-in](/docs/sign-in). For one-click **Sign in with GitHub**, run a [sign-in service](/docs/sign-in-service), name it in the site's config, and put the site's address in **Site settings**. The first time you sign in at `/admin`, the sign-in screen then offers to install the service's app on the repository, which signs you in too.

**GitLab:** editors can sign in with an access token straight away. For one-click **Sign in with GitLab**, register the admin panel with GitLab once:

1. Go to your profile's **Preferences → Applications** (or a group's **Settings → Applications**) and add an application.
2. Set the **Redirect URI** to the admin panel's address with a trailing slash, such as `https://your-site.example/admin/`, leave **Confidential** off, and choose the `api` scope.
3. Copy the **Application ID** into the config: `gitlab({ project: "your-name/your-site", clientId: "…" })`. If the site moves to a domain of its own later, add its new admin address as a redirect URI too.

**Bitbucket:** editors can sign in with a repository access token or an Atlassian API token straight away (see [Editors and sign-in](/docs/sign-in#bitbucket)). For one-click **Sign in with Bitbucket**, register the admin panel with Bitbucket once:

1. In the workspace's **Settings → OAuth consumers**, add a consumer.
2. Set the **Callback URL** to the admin panel's address with a trailing slash, such as `https://your-site.example/admin/`, leave **This is a private consumer** off, and give it the **Account: Read**, **Repositories: Write**, **Pull requests: Write** and **Pipelines: Write** permissions.
3. Copy the consumer's **Key** into the config: `bitbucket({ repo: "your-workspace/your-site", clientId: "…" })`. If the site moves to a domain of its own later, change the callback URL to its new admin address.

Every editor needs permission to change the repository: on GitHub, write access; on GitLab, the Developer role or higher; on Bitbucket, Write.

## Your own domain

To put the site at a domain of your own, such as `example.org`, connect it in the admin panel: see [Custom domains](/docs/custom-domains).
