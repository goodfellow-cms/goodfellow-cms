---
version: 1
title: Content in a repository of its own
description: Keeping a site's content and its code in two repositories, so the tokens editors and full-stack sites' servers use can change the content but never the code.
section: developers
order: 7.5
---

Most sites keep everything in one repository: the code, `content/` and `public/media/`. Anyone who can publish to it can change the code too, and so can the token that publishing uses, whether it's an editor's or a [full-stack site's server's](/docs/full-stack-nextjs). Code runs when the site is built, with whatever secrets the build has, such as a full-stack site's token and keys.

A site can keep its content in a repository of its own instead. Editors' sign-in, publishing, the [Claude connector](/docs/claude-connector) and a full-stack site's server then reach only the content repository, so they can change the site's content but never its code.

It's for organizations with a developer, who looks after the code repository. It doesn't keep Goodfellow's own settings away from editors: Site Settings, custom CSS and code, and collections' settings stay with the content, since some saves change settings and content together, such as removing a collection's field from every item. On a full-stack site, the app's own roles do that.

## Creating a site this way

`create-goodfellow` asks where the content should be kept once it knows the repository and the host, and offers the code's repository's name with `-content` after it. To skip the questions:

```sh
npm create goodfellow@latest my-site -- --github your-name/my-site --content your-name/my-site-content --host github-pages
```

`--github` or `--gitlab` is the code's repository, and `--content` the content's, on the same host. On Vercel, `--build content` or `--build code` says which repository Vercel builds the site from (see below). The [setup page](/new-site) doesn't offer this yet.

The new site's folder is the code's repository, with the content's inside it, which the code ignores:

```text
my-site/                  the code's repository
  goodfellow.config.tsx   backend: github({ repo: "your-name/my-site-content", contentOnly: true })
  blocks/ src/ package.json
  content-repository/     the content's repository
    content/
    public/media/
  content       → content-repository/content
  public/media  → content-repository/public/media
```

`content/` and `public/media/` are links into `content-repository/`, so `npm run dev` reads and saves the content repository's own files. Push both repositories, then set up the build as below. Each setup file says what it needs, and the code's README.md says which files are where.

## Which repository builds the site

Whoever can push to the repository a host builds from controls the build: its setup files and its code. So:

| Site | Builds from |
|---|---|
| On GitHub Pages or GitLab Pages | The content repository, which publishes the site with Pages |
| On Vercel, with no secrets in its Vercel project | Either: building from the content repository lets the admin panel show when changes are live |
| A [full-stack Next.js site](/docs/full-stack-nextjs) | The code repository, always, since its build has the server's token and keys |

### GitHub Pages

- **The content repository's** `.github/workflows/deploy.yml` checks out the code, puts the content in it with `goodfellow content copy`, builds the site and publishes it with GitHub Pages, whenever the content changes, once a night, and when the code repository asks. Turn GitHub Pages on in its Settings → Pages, with "GitHub Actions" as the source.
- **The code repository's** `.github/workflows/update.yml` installs Goodfellow's fixes each night, building the site with the content to check it still works, and then asks the content repository to build the site. It does that, and after each change to the code, if it has a `GOODFELLOW_BUILD_TOKEN` secret: a fine-grained token for the content repository only, with Actions read and write. Without it, changes to the code go live with the content repository's nightly build.
- **Private repositories:** a workflow reads the other repository with a deploy key. Make a key pair (`ssh-keygen -t ed25519 -f key -N ""`), add `key.pub` to the repository being read under Settings → Deploy keys without write access, and `key` to the one reading it as a secret: `GOODFELLOW_CODE_KEY` in the content repository, `GOODFELLOW_CONTENT_KEY` in the code repository. Public repositories need neither.

### GitLab Pages

- **The content project's** `.gitlab-ci.yml` clones the code, copies the content into it, builds the site and publishes it with GitLab Pages, whenever the content changes and when the code project's pipeline starts it.
- **The code project's** `.gitlab-ci.yml` installs Goodfellow's fixes on scheduled pipelines and then starts the content project's pipeline, as it does after every change to the code. Set up a pipeline schedule to run each night under Build → Pipeline schedules, and turn on "Allow Git push requests to the repository" under Settings → CI/CD → Job token permissions, which lets it publish updates.
- **Private projects:** each pipeline reads the other project with its job token, which that project has to allow: add each project to the other's job token allowlist, under Settings → CI/CD → Job token permissions.

### Vercel

- **Building from the code repository:** its `vercel.ts` clones the content repository when Vercel installs the site. If the content repository isn't public, add a token that can only read it as the Vercel project's `GOODFELLOW_CONTENT_TOKEN` environment variable. The content repository asks Vercel to rebuild the site whenever it changes, and each night (on GitLab, with a pipeline schedule), with the Vercel project's deploy hook (Settings → Git → Deploy Hooks), which can only start builds: add it there as `VERCEL_DEPLOY_HOOK`, a secret on GitHub or a masked variable on GitLab.
- **Building from the content repository:** import the content repository in Vercel. Its `vercel.ts` clones the code into `site/` and builds it with the content, with a `GOODFELLOW_CODE_TOKEN` environment variable if the code repository isn't public. The code repository asks Vercel to rebuild the site whenever the code changes, with the deploy hook, as above.

On GitHub, a token that can only read a repository is a fine-grained token for it with Contents read; on GitLab, a project access token with the Reporter role and the `read_repository` scope.

## Working on the site

Clone the code, then the content into its `content-repository/` folder, and link it:

```sh
git clone https://github.com/your-name/my-site.git
cd my-site
git clone https://github.com/your-name/my-site-content.git content-repository
npm install
npx goodfellow content link
npm run dev
```

On a Next.js site, the command is `npx goodfellow-next content link`. Changes made in the admin panel of `npm run dev` are saved in `content-repository/`, where they're committed like any change to a repository. On Windows the links are junctions, which hold the whole folder's path: run `goodfellow content link` again after moving the folder.

Adding and removing blocks from [block registries](/docs/add-blocks) changes code, so it's done here, in the admin panel of `npm run dev`, and committed to the code repository. The published site's admin panel has no Blocks screen.

## In the admin panel

- **Signing in** reaches the content repository only: on GitHub, [Goodfellow's sign-in](/docs/sign-in) needs to be installed on the content repository, and the Editors screen lists the content repository's people.
- **Blocks** are added by the site's developer, as above.
- **Updates** are installed in the code repository, by its setup or by its developer with `goodfellow update`, so the Updates screen only says so. Going back to an older release doesn't skip the release it left, since that's set in the content: add it to `skip` in the content repository's `content/updates.json`, or turn automatic updates off there.
- **"Live"** shows where the content repository builds the site. Where Vercel builds from the code repository, the admin panel can't tell when changes are live.

## Full-stack Next.js sites

Point `goodfellow.config.tsx`'s `backend` at the content repository, with `contentOnly: true`, and give the server a token for the content repository only as `GOODFELLOW_GIT_TOKEN`. The server then refuses to write anything but content, whoever asks. The site builds from the code repository, which needs the content when it builds: clone it into `content-repository/` and run `npx goodfellow-next content copy` before `npm run build`, as the Vercel setup's install does. Publishing changes the content repository, so it has to start the build, as the Vercel setup's deploy hook does.

## Moving an existing site

1. Make the content repository, with the site's `content/` and `public/media/`. To keep their history, make it from a copy of the site's repository with [git filter-repo](https://github.com/newren/git-filter-repo): `git filter-repo --path content --path public/media`.
2. In the code repository, remove `content/` and `public/media/`, and add these lines to `.gitignore`:

   ```text
   /content-repository/
   /content
   /public/media
   ```

3. Change the config's `backend` to the content repository, with `contentOnly: true`, such as `github({ repo: "your-name/my-site-content", contentOnly: true })`.
4. Replace the deploy setup with the one `create-goodfellow --content` makes for the same host, from a new site made with the same choices.
5. On GitHub, install [Goodfellow's sign-in](/docs/sign-in) on the content repository, and give editors access to it.
