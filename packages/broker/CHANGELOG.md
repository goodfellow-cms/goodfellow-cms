# @goodfellow-cms/broker

## 0.11.0

### Patch Changes

- f6fcc1a: Goodfellow's documentation is now at https://goodfellowcms.com, and the links the packages give, in their READMEs, the admin panel's help links, and the Claude Desktop extension, go there. The old address, https://goodfellow-cms.github.io/goodfellow-cms/, sends people to the same page at the new one.
- d813bd5: The backends', the command line's, the Claude connector's, create-goodfellow's, and the token broker's English use the Oxford comma in lists ("GitHub, GitLab, or Bitbucket").
- 0255dbc: More fixes from November's security review:
  
  - The local backend in `goodfellow dev` and `next dev`, and the Claude connector's folders, never follow a link inside an editable folder to files outside it; the folders themselves may still be links, as a content repository's are.
  - The Claude connector's screenshots run the browser in Chrome's sandbox, without the connector's tokens in its environment.
  - A plugin can't ask to read `*`, `.git`, or files of secrets such as `.env.local`, or for Goodfellow's own `GOODFELLOW_` variables.
  - Bitbucket sites' lockfile step publishes `package-lock.json` only once every new package comes from npm's registry, as GitHub's and GitLab's do. Sites made by an earlier release keep their `bitbucket-pipelines.yml` until it's copied from a new site's.
  - WordPress imports take only web addresses for attachments, and importing on a computer downloads them only from public `https://` addresses or the site it was read from, no larger than the upload limit.
  - Expo apps open redirects to other sites only over the web, and take the site's base path only where it's a path.
  - Cleaning an SVG's CSS goes on until taking out an `@import` or `url()` can't join what's around it into another, and leaves the CSS out whole where something would still load from elsewhere, as an unfinished `url(` would.
  - Rich text can't take an id Goodfellow's own scripts look up by spelling it with character references, such as `&#103;f-consent`.
  - A full-stack site's AI proxy (`aiServer()`) sends on only the fields the AI assistant sends: Claude's own models, answers no longer than the assistant asks for, text messages and structured answers, and only its beta, so an editor can't spend the site's key on tools, files, or other models. `models` on a service's key limits the models editors may ask for.
  - GitLab and Bitbucket sites list and close only their own repository's merge and pull requests as drafts' reviews, never one from a fork that uses a draft's branch name.
  - The sign-in worker that `create-goodfellow` carries, which owners deploy, takes its setup page's forms only from that page, and always writes a new session key while it's being set up.
  - The token broker publishes a draft with exactly the changes it checked, so nothing added to the draft in between goes live unchecked, and frames the admin panel at the screen an address names without what a sign-in brought back, such as the sign-in worker's grant or Bitbucket's token.
  - The Claude connector reads a site's description as builds read other sites' files: from public `https://` addresses only (or a folder's development server), no larger than 5 MB, and within 15 seconds.
  - A plugin installed from the admin panel runs its tasks only from its own package, so a task's description can't send its secrets to a file of the site's.
  - The nightly update no longer changes blocks from Goodfellow's registry, and its publishing job on GitHub refuses `blocks/installed/`, `components/`, `lib/`, and `hooks/`, since the job that made the update ran the site's packages, which could have written code there. The Blocks screen offers **Update** where a newer version of an added block is ready, and `goodfellow update --blocks` (or `goodfellow-next update --blocks`) updates them all. GitHub sites made by an earlier release keep their workflow's older check until it's copied from a new site's, since updates can't change workflows.
- 749d66b: Security fixes from the second November review:
  
  - Markdown items show text after an inline `<kbd>`, `<code>`, `<pre>`, or `<script>` tag as text, where it could carry live HTML onto the site's pages.
  - A full-stack site's server publishes only on top of the live site as it is now, whatever revision the browser names, so a change waiting for review can't come along with an editor's own; the GitHub backend checks the same before every commit, moves the branch only from that commit in the same request, and takes only commits' ids as revisions.
  - The sign-in service finishes a sign-in only in the browser that started it, so a link to GitHub that someone else started can't send an owner's sign-in to them. New sign-in services get it; an existing one gets it with its next weekly update, or by copying create-goodfellow's `templates/sign-in/` over it.
  - `next dev`'s local backend answers nothing while other computers can reach the development server, and the Next.js starter starts it with `next dev --port 4321 -H 127.0.0.1`. On a site made by an earlier release, change the `dev` script in `package.json` to that.
  - Publishing a draft refuses one that changes files the admin panel never edits, such as the site's configuration, packages, or workflows (anything outside its content, its media, and the folders the admin panel installs blocks and plugins into), which only reach a draft when someone saves them there on the site's host, and publishes exactly the changes the admin panel's **Publish all** and Claude's `publish` checked, media included.
  - A token broker makes each change again before checking it, so the change it checks is the one it publishes, and checks the changes a draft is asked to publish, and theme and plugin records written as bytes.

## 0.10.1

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

### Minor Changes

- 19d7812: Owners can install an update of a plugin or theme the site has before it's three days old, with **Install now**, where both the version installed and the new one have npm provenance from the same repository and workflow. First installs, releases without provenance and releases built anywhere else still wait, and waiting stays the default. Where the site is built, the check is made again with Sigstore's signatures: the lockfile job (through `goodfellow-early`, run from npm) for plugins, `goodfellow build` and `goodfellow-next finish` for themes, and the full-stack server before review, failing loudly rather than falling back. The token broker names the release's repository in its own dialog. The starters' workflows have the new lockfile step, and their builds don't run after the lockfile job fails.

### Patch Changes

- 19d7812: The nightly update's publish job publishes only what an update changes, with packages only from npm's registry; plugins can't ask for CI services' and hosts' own variables; the token broker asks before showing the admin panel from a new address, and can be held to one in `broker.json`; and the sign-in worker revokes a code repository's token whatever stops it being given.
- d0a47cb: Packages' npm descriptions, and the Claude Desktop extension's name, say Goodfellow CMS, the official name, so they're easier to find.

## 0.8.0

### Minor Changes

- d21884a: On sites kept on GitHub, Site Settings has a Comments screen that sets up comments: it makes a public repository of their own beside the site's, with Discussions turned on, or connects one you already have, and publishes where they're kept as `content/site.json`'s `comments`, which the Comments block now shows without Giscus's code. The same screen lists visitors' comments page by page, and hides, shows and deletes them and closes pages to new ones. Where the sign-in can't reach that repository, as with the sign-in service, it asks for a GitHub token of the owner's own, kept only in the tab. GitHub backends offer this as `comments` (`SiteComments`), and the token broker asks before making the repository or deleting a comment.

### Patch Changes

- 382fe4f: The token broker refuses to show an admin panel at its own address, where the admin panel could read the sign-in and AI keys it keeps, as a site's settings pointing at another site on a shared host would make it, and its bar now names the address of the admin panel it shows.
- 86ad949: Security fixes from a review:
  
  - The token broker refuses calls it doesn't list, and asks before changing domains, taking someone's access away, running a plugin's task, setting up updates or throwing away a draft. It also never publishes `bitbucket-pipelines.yml`.
  - `goodfellow task` and `goodfellow-next task` load the site's config in a process of its own that has none of the job's secrets, so the config and the packages it loads can't read them.
  - The GitHub backend lists every pending invitation and organization, not only the first 100.
  - GitLab removes a scheduled-change pipeline schedule it couldn't give its variable.

## 0.7.0

### Minor Changes

- 42cf54b: Owners can limit what each editor changes, on the Editors screen's Limits section: page sections with their translations, collections' items, the media library, the header and footer, the menus, and languages, kept in `content/permissions.json`. Everything else is read-only to them, and publishing changes outside their limits offers Submit for review, which asks the site's reviewers (every owner, unless the file names some) on GitHub, GitLab and Bitbucket. Owners see drafts waiting for their review in the draft bar, and publishing or throwing away a draft closes its review. The token broker and the Claude connector keep to the same limits, and full-stack sites' servers refuse writes outside them. The sign-in service's everyday app now asks for Pull requests, which submitting for review needs.

## 0.6.0

### Minor Changes

- 1b9781e: Sites stored on Bitbucket Cloud, with `@goodfellow-cms/bitbucket`: sign-in with a repository access token, an Atlassian API token or Bitbucket's own sign-in, publishing as one commit that fails when someone else has published since, version history, drafts and pull requests, editors from the workspace, failed rebuilds explained, the nightly update, scheduled changes that go live at their time (each with a one-off Pipelines schedule) and plugins' tasks through Bitbucket Pipelines, and content in a repository of its own, with Vercel putting the site online. `create-goodfellow --bitbucket` creates such sites, with `--content` too, `goodfellow due` and `goodfellow-next due` take `--output`, and the token broker, the Claude extension, the Claude connector service and the admin panel know Bitbucket too.
- 2f6c59e: Plugins can offer a page editor of their own (`editor` in a plugin, its admin module's `editor.mount()`), which each person editing the site can choose in place of the standard editor from the editor's header, for pages and, where the plugin says so, the header, footer and collections' templates. It runs in the plugin's sandboxed frame, is given what's edited, the blocks' fields, the site's settings and pages, the media library and the link preview, and hands back what's edited; the admin panel keeps Publish, drafts, the AI assistant, and Undo and Redo, and publishes only what passes `checkEditedData()` against the site's blocks. The Plugins screen and the token broker say when a plugin offers an editor, and installed plugins need approving again to add one.
- f591bc0: Plugins can keep a site's media in a storage service in place of `public/media/`, as S3 storage (`goodfellow-plugin-s3`, in a repository of its own) does. A plugin with `mediaStorage` takes the Media screen's uploads, larger ones too, and `content/media-storage.json` lists the files it keeps by their `/media/` addresses, which builds, `goodfellow dev` and Next.js show from the storage's public address, so pages don't change. The Media screen moves the site's own files there and back.
  
  Plugins can also run tasks in the site's CI, with secrets the admin panel never holds: an admin module calls `api.task(id, input)`, and the starters' new `.github/workflows/plugin-task.yml`, or the `plugin-task` job in `.gitlab-ci.yml`, runs `goodfellow task` (`goodfellow-next task`) with only the secrets the plugin declared, sealing the answer to a key only that admin panel holds. It takes about a minute. `goodfellow dev` and `next dev` run tasks on the computer, and full-stack sites pass them through their server. Sites made earlier copy the starter's `plugin-task.yml`, or the `plugin-task` job and the `pages` job's new rule, to run tasks.
  
  Plugins' screens fill the screen as the admin panel's own do, drawing their own heading in a frame as tall as what they draw. `api.secretsHelp()` tells a plugin how the site's owner adds its secrets for this site, in steps for GitHub, GitLab, the development servers' `.env.local` or a full-stack site's server, and a site's config can give a plugin `options`.
- 4c909ac: Install plugins from the admin panel. Site Settings → Plugins finds `goodfellow-plugin` packages on npm, offers releases at least three days old that say they work with the site's Goodfellow release, and shows what each asks to do (its `goodfellow-plugin.json`) and what its packages' code could do: network requests, other programs, code made from text, native code and install scripts. Installing adds the package to `package.json` at an exact release and records what was approved in `plugins/installed/`, whose `index.ts` sites' configs import as `installedPlugins`; a plugin asking for more than that stops the site from loading. It's offered at a checked admin address or with a token broker, whose own dialog names the plugin and what it asks to do; full-stack sites submit it for review. The starters' workflows, and Cloudflare Pages' generated ones, write `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, running none of the new code, and build the site with it. The Updates screen warns about releases outside an installed plugin's range, and `create-goodfellow --plugin` installs plugins in new sites. Sites made earlier need the starter's `deploy.yml` or `.gitlab-ci.yml` before the Plugins screen installs anything.

## 0.5.0

### Minor Changes

- 043358b: Add a token broker from the admin panel: Site Settings' Security tab makes the broker's repository from Goodfellow's released page, with a token that can create repositories, and puts it online with GitHub Pages (at a domain of its own) or GitLab Pages (at the project's unique domain), or leaves it ready for Cloudflare Pages or Vercel. `goodfellow broker add`, `use` and `remove` do the same from a computer. `create-goodfellow` (`--admin`, `--broker`, `--broker-domain`) and the setup page offer an admin address or a sign-in page of its own for new sites. The docs have a new Security page.
- e62801d: Drafts in the admin panel. The editors' **Add to draft**, beside **Publish**, keeps a change on a draft branch instead of publishing it, and while a draft is open every Publish adds to it. A bar on every screen shows the draft, with **Publish all**, which runs the site checks over everything in it and publishes it in one change with one rebuild, **Submit for review**, **Throw away** and **Back to the live site**. Drafts stay when the tab closes, other editors see them, and ones started from Claude can be finished there. Full-stack sites, demos and the development servers keep the draft in the browser instead (`keptDrafts()`). Drafts can be listed (`SiteDrafts.list()`), list the files they changed (`Draft.paths()`), and start at a given revision (`create(name, { from })`). The starters' `vercel.ts` turns off Vercel's previews of draft branches; existing sites on Vercel can add its `git: { deploymentEnabled: { "goodfellow-draft-*": false } }` line, and sites on Cloudflare Pages can set preview branches to None.
- f9a405e: The token broker: a sign-in page on an address of its own, released as `@goodfellow-cms/broker`, which keeps editors' GitHub or GitLab sign-in and AI keys, shows the admin panel in a frame and makes every call to the git host and AI services for it, so nothing on the site's address can read them. It asks the editor in its own part of the page before publishing the site's code, custom code or a new Site address, installing a release or giving someone access, never changes workflows, and asks for owner tokens itself. The config's new `broker` line, which Site Settings' Security tab sets, makes the admin panel open only inside the broker, which the sign-in worker then gives tokens to alone. With a broker, the Blocks screen offers the config's other registries too. The admin address's guard and header rules let the broker frame the admin panel.
