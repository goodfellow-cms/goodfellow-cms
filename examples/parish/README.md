# St. Joseph Parish (example)

An example parish website built with [Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms). **St. Joseph Parish is made up**: its name, address, phone number, staff, history, Mass times and events are invented, and the pictures are simple drawings. Replace them all with your own before putting the site online.

Start a site from this example with `npm create goodfellow@latest my-parish -- --template parish`.

## Working on the site

<!-- goodfellow-repository -->
> **In the Goodfellow repository**, this folder is part of a pnpm workspace, so `npm install` doesn't work here. From the repository's root, run `pnpm install` and `pnpm build` (get pnpm with `corepack enable`, or `npm install -g pnpm`), then `pnpm dev` in this folder. The `npm` commands below are for a site of your own, created with `npm create goodfellow`, which leaves this note out.
<!-- /goodfellow-repository -->

```sh
npm install
npm run dev      # site at http://localhost:4321, admin panel at http://localhost:4321/admin
npm run build    # builds the site into dist/
npm run preview  # serves dist/
```

On your own computer, the admin panel saves straight to the files in `content/`.

## What's in it

- **Pages:** home, Mass times, sacraments, events, news, bulletins, about us and contact, with a submenu under **Parish life**.
- **Collections**, edited under **Collections** in the admin panel:
  - **Events**, with a date, time and place. The home page shows the next three, and the events page splits upcoming and past events. Lists of upcoming events change by date, so the site's nightly rebuild keeps them current.
  - **News** stories, newest first.
  - **Bulletins:** each one links to a PDF uploaded on the **Media** screen.
  - **Staff**, listed on the About us page. They have no pages of their own, and the **Order** field sets who comes first.
- **Contact details** (address, phone and email) are set once in **Site settings → General**, and shown in the footer and on the contact page by the **Contact details** block.
- **More blocks**, such as an FAQ and tabs, can be added on the admin panel's **Blocks** screen. See [Add blocks](https://goodfellow-cms.github.io/goodfellow-cms/docs/add-blocks).
- **The parish's own blocks**, in `blocks/`, show how a developer adds blocks to a site. They're listed under **Parish** in the editor:
  - **Mass times:** a list of days and times, each with an optional note.
  - **Scripture quote:** a short passage with its reference. The example uses the Douay-Rheims Bible (Challoner revision), a Catholic translation in the public domain; most modern translations need permission to quote.
  - **Notice:** an announcement that stands out from the text around it.

  Each block is a React component plus the fields the editor shows for it. They're added to the editor in `goodfellow.config.tsx`. Never rename a block's key or its fields once pages use them, since content files refer to them by name. Parts of a block that respond to visitors, such as a button that shows more, go in a file starting with `"use client"`, and only pages that use them load JavaScript: see [Interactive blocks](https://goodfellow-cms.github.io/goodfellow-cms/docs/interactive-blocks).

## Making it yours

1. In **Site settings**, change the parish's name, contact details, logo, colors and fonts.
2. Edit the Mass times on the home page and the Mass times page.
3. Replace the example events, news, staff and bulletins under **Collections**, and the pictures on the **Media** screen.
4. Rewrite the about us, sacraments and contact pages, and remove the note at the bottom of the footer (in **Header & footer**).

## Putting the site online

Setup takes four steps. It's done once, usually by whoever set up the site.

### 1. Store the site on GitHub or GitLab

Create an empty repository on GitHub or GitLab, without a README, and push this folder to it:

```sh
git remote add origin https://github.com/your-name/your-site.git   # unless origin is already set
git push -u origin main
```

`create-goodfellow` makes the new site a git repository on the branch `main`, with everything, `package-lock.json` included, in its first commit, and sets `origin` when it's given the repository. Commit any changes since (`git add -A` and `git commit`) before pushing.

### 2. Tell Goodfellow where the site is stored

If you gave the repository when creating the site with `npm create goodfellow`, this is already done. Otherwise, in `goodfellow.config.tsx`, uncomment one `backend` line and its `import`, and fill in your repository:

```tsx
import { github } from "@goodfellow-cms/github";

export default defineConfig({
  blocks,
  categories,
  backend: github({ repo: "your-name/your-site" }),
});
```

Builds include the admin panel at `/admin` only once a backend is set. If the live site is built from a branch other than the repository's default branch, add `branch: "name"`.

Also set the site's address under **Site settings → General → Site address**, including any subfolder (such as `https://your-name.github.io/your-site`). It's used for the sitemap and for link previews.

### 3. Choose a host

Each host's free plan has its own rules about business use. If the site is for a business, sells anything, shows ads, or is built or looked after by someone who's paid for it, check those rules first. As of October 2026, GitHub Pages and Vercel's free plan don't allow most of these, and GitLab Pages has no rule against them that we know of. See [Hosts and business sites](https://goodfellow-cms.github.io/goodfellow-cms/docs/hosts) in Goodfellow's documentation.

**GitHub Pages** (free for public repositories; not for online businesses or shops)

1. In the repository on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push. `.github/workflows/deploy.yml` builds and publishes the site on every change and once a night, and `.github/workflows/scheduled.yml` starts it within the hour when a scheduled page or item comes due. If your main branch isn't called `main`, change it in `deploy.yml`.

**GitLab Pages** (free, including for private projects; no rule against business sites that we know of)

1. Push. `.gitlab-ci.yml` builds and publishes the site on every change to the default branch.
2. For nightly rebuilds, add a schedule under **Build → Pipeline schedules**.
3. The site's address is under **Deploy → Pages**.

**Vercel** (works with GitHub and GitLab; the free plan is for non-commercial sites only)

1. Import the repository in Vercel. `vercel.ts` already has the right settings, and has Vercel send the site's redirects itself.
2. For nightly rebuilds, create a deploy hook under **Settings → Git → Deploy Hooks**, and call it from a scheduled GitHub Action or GitLab pipeline schedule.

Delete the setup files for the hosts you don't use.

### 4. Set up sign-in

**GitHub:** nothing to set up. Editors sign in at `/admin` with an access token. The admin panel links to GitHub's token page with the right permissions already chosen. On that page, under **Repository access**, choose **Only select repositories** and pick the site.

- Editors who are collaborators on someone else's personal repository can't use that kind of token. They can use the "broader token" link instead. Alternatively, move the repository into a free GitHub organization and make editors members.

**GitLab:** editors can sign in with an access token straight away. For one-click **Sign in with GitLab**, register the admin panel with GitLab once:

1. Go to your profile's **Preferences → Applications** (or the group's **Settings → Applications**) and add an application.
2. Set:
   - **Redirect URI:** the admin panel's address with a trailing slash, such as `https://your-site.example/admin/`.
   - **Confidential:** leave this **off**.
   - **Scopes:** `api`.
3. Copy the **Application ID** into the config: `gitlab({ project: "your-name/your-site", clientId: "…" })`.

Every editor needs permission to change the repository: on GitHub, write access; on GitLab, the Developer role or higher.

## Images and files

Upload images and files, such as the weekly bulletin, on the admin panel's **Media** screen, or with the **Choose image** button wherever an image goes. They're saved in `public/media/`, and large photos are made web-sized automatically.

## Writing with AI

The admin panel's **AI** tab can draft pages, rewrite blocks and fill in events and news stories. Each editor picks an AI service there. Claude and some others need the editor's own API key and charge for use; there are free options, including copying the request into a chat app such as Claude.ai. To offer only some services, or to turn the assistant off, see `ai` in [Configuration](https://goodfellow-cms.github.io/goodfellow-cms/docs/configuration).

## Publishing

Each **Publish** in the admin panel saves its changes as one commit to the main branch, which starts a new build. The admin panel shows when the live site has been updated, usually within a minute or two. If someone else changed the same page in the meantime, publishing stops and explains what happened, instead of overwriting their work.
