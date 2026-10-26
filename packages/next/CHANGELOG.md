# @goodfellow-cms/next

## 0.6.0

### Minor Changes

- 1b9781e: Sites stored on Bitbucket Cloud, with `@goodfellow-cms/bitbucket`: sign-in with a repository access token, an Atlassian API token or Bitbucket's own sign-in, publishing as one commit that fails when someone else has published since, version history, drafts and pull requests, editors from the workspace, failed rebuilds explained, the nightly update, scheduled changes that go live at their time (each with a one-off Pipelines schedule) and plugins' tasks through Bitbucket Pipelines, and content in a repository of its own, with Vercel putting the site online. `create-goodfellow --bitbucket` creates such sites, with `--content` too, `goodfellow due` and `goodfellow-next due` take `--output`, and the token broker, the Claude extension, the Claude connector service and the admin panel know Bitbucket too.
- f591bc0: Plugins can keep a site's media in a storage service in place of `public/media/`, as S3 storage (`goodfellow-plugin-s3`, in a repository of its own) does. A plugin with `mediaStorage` takes the Media screen's uploads, larger ones too, and `content/media-storage.json` lists the files it keeps by their `/media/` addresses, which builds, `goodfellow dev` and Next.js show from the storage's public address, so pages don't change. The Media screen moves the site's own files there and back.
  
  Plugins can also run tasks in the site's CI, with secrets the admin panel never holds: an admin module calls `api.task(id, input)`, and the starters' new `.github/workflows/plugin-task.yml`, or the `plugin-task` job in `.gitlab-ci.yml`, runs `goodfellow task` (`goodfellow-next task`) with only the secrets the plugin declared, sealing the answer to a key only that admin panel holds. It takes about a minute. `goodfellow dev` and `next dev` run tasks on the computer, and full-stack sites pass them through their server. Sites made earlier copy the starter's `plugin-task.yml`, or the `plugin-task` job and the `pages` job's new rule, to run tasks.
  
  Plugins' screens fill the screen as the admin panel's own do, drawing their own heading in a frame as tall as what they draw. `api.secretsHelp()` tells a plugin how the site's owner adds its secrets for this site, in steps for GitHub, GitLab, the development servers' `.env.local` or a full-stack site's server, and a site's config can give a plugin `options`.
- b803050: Plugins' frames come with the notices of what they bundle: `goodfellow build`, `goodfellow dev`, `goodfellow-next finish` and `next dev` write `admin/plugins/<id>/LICENSES.txt` beside each frame, listing every package it bundles with its version, license and where its source is, then each license text once, and the frame's page links to it. Editor plugins' `session.styles()` gives `{ stylesheets, tailwind }`, with Tailwind's source for classes the site's last build hasn't seen, and `htmlBlocks()` in `@goodfellow-cms/core/wordpress` turns pasted HTML into the site's blocks with the WordPress import's conversion.
- 4c909ac: Install plugins from the admin panel. Site Settings → Plugins finds `goodfellow-plugin` packages on npm, offers releases at least three days old that say they work with the site's Goodfellow release, and shows what each asks to do (its `goodfellow-plugin.json`) and what its packages' code could do: network requests, other programs, code made from text, native code and install scripts. Installing adds the package to `package.json` at an exact release and records what was approved in `plugins/installed/`, whose `index.ts` sites' configs import as `installedPlugins`; a plugin asking for more than that stops the site from loading. It's offered at a checked admin address or with a token broker, whose own dialog names the plugin and what it asks to do; full-stack sites submit it for review. The starters' workflows, and Cloudflare Pages' generated ones, write `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, running none of the new code, and build the site with it. The Updates screen warns about releases outside an installed plugin's range, and `create-goodfellow --plugin` installs plugins in new sites. Sites made earlier need the starter's `deploy.yml` or `.gitlab-ci.yml` before the Plugins screen installs anything.
- 11a429f: Plugins, which developers add in the site's config (`plugins`), add what blocks can't: an admin module run in a sandboxed frame of its own whose Content Security Policy reaches only the addresses it declares, screens in Site Settings that read and publish only the files it declares, build steps each run in a Node process of its own with Node's permission model and only the secrets it declares, and routes on full-stack Next.js sites' servers, as well as blocks of their own. Blocks in the editor ask a plugin's services with `useSite().callPlugin`. See the docs' Plugins page.

### Patch Changes

- Updated dependencies [1b9781e]
- Updated dependencies [3436a92]
- Updated dependencies [2f6c59e]
- Updated dependencies [f591bc0]
- Updated dependencies [6bf08ae]
- Updated dependencies [b803050]
- Updated dependencies [4c909ac]
- Updated dependencies [11a429f]
- Updated dependencies [be7bbec]
- Updated dependencies [b9b0434]
  - @goodfellow-cms/core@0.6.0
  - @goodfellow-cms/admin@0.6.0
  - @goodfellow-cms/react@0.6.0
  - @goodfellow-cms/ai@0.6.0

## 0.5.0

### Minor Changes

- 938e468: An address of its own for the admin panel, such as `admin.example.org`, so the site's pages can't reach what it keeps. Site Settings' Domain screen sets it on GitLab Pages, Cloudflare Pages and Vercel, writing the config's new `admin` line: `goodfellow build` and `goodfellow-next finish` then start every page with a script that sends it to the Site address when it's opened at the admin address, fail if a page can't start with it, and write Cloudflare Pages' header rules, while the starters' `vercel.ts` and `withGoodfellow()` give Vercel's. Once the admin panel has checked the address from there, it opens only there and refuses to be shown in a frame. The sign-in worker gives tokens to the admin address too. The Blocks screen offers blocks from the config's `registries`, and shadcn/ui's own, only at a checked admin address and in `goodfellow dev` and `next dev`. GitLab's backend can publish files outside the editable folders, such as the config.
- e819602: Cloudflare Pages as a host. `create-goodfellow --host cloudflare-pages` and the setup page give a site a nightly update and rebuild, and the checks for scheduled changes, on GitHub Actions or GitLab CI, which ask Cloudflare to rebuild through the project's deploy hook (`CLOUDFLARE_DEPLOY_HOOK`). The admin panel shows when Cloudflare has built the site, from its check runs and commit statuses, and GitHub token links ask for Commit statuses. `goodfellow build` and `goodfellow-next finish` write `_redirects`, so Cloudflare sends the site's redirects itself. The Domain screen explains connecting a domain in Cloudflare, and the media library notes Cloudflare's terms for videos.
- ba80f97: Sites whose content is kept in a repository of their own can have an admin address. The Domain screen connects it and shows what a developer runs: `goodfellow admin add` names it in the code's `goodfellow.config.tsx`, and `goodfellow admin check` checks it from a computer, as the Domain screen does from the address, then marks it checked (`goodfellow-next admin` for Next.js sites, which also get `goodfellow-next broker use` and `remove`). Where Vercel builds the site from the content repository, the address's header rules are written into its `vercel.ts`. `create-goodfellow --admin` and the setup page offer an admin address with a content repository too.
- 9b96dd3: The editor's sandbox. The admin panel's page, which signs in and publishes, no longer loads the site's config or any block's code: Puck, the config and every block run in frames sandboxed without `allow-same-origin`, which talk to the page through one message port, so blocks can't reach editors' tokens or AI keys. The page draws the editor's header, Undo and Redo, preview widths, Publish and the AI panel outside the frame; the Settings, Version history and Site history previews, the pages rendered to check a publish and the preview page for screenshots are frames too. The site's CSS is kept to the editor's canvas, with its width media queries as container queries, so the phone and tablet buttons show the site at those widths. The frames' Content Security Policy lets them fetch nothing and run only the site's own scripts, which first remove WebRTC.
  
  `Admin` takes `site` (`adminSite()` from `@goodfellow-cms/react`) and `frames` in place of `config`; `GitHost.source` lets the admin panel make the site's git host again. `goodfellow build` writes the frames' page at `admin/editor/`. Next.js sites get `app/admin/editor/page.tsx` (`GoodfellowEditor` from `@goodfellow-cms/next/editor`), their `app/admin/page.tsx` becomes a server component passing `site.admin()` to `GoodfellowAdmin`, and `goodfellow-next finish` writes the editor page's policy. An `app/admin/page.tsx` that still passes `config` loads every block's code itself, so the admin panel only says how to update it there and never signs in; `goodfellow-next update` replaces it with the starter's, and adds the editor page, wherever nobody has changed it, on its first run after this release. Every frame is sandboxed with `allow-scripts` alone, in `goodfellow dev` and `next dev` too: they bundle the frames as builds do, rebuild them as the site's code changes and reload the frames, leaving the admin panel's page as it is. `@goodfellow-cms/next` depends on Rolldown for that, loaded only in `next dev`.
- 1590ea2: Export a site to WordPress, as a WordPress export file that WordPress's importer reads: from Site Settings → WordPress, or with `goodfellow export wordpress` and `goodfellow-next export wordpress`. Pages keep their addresses and their blocks become WordPress's, items of collections with pages become posts with their categories and tags, and the menus and media library come too. The Import tab is now called WordPress.
- 78d29e5: Import a WordPress site's pages, posts, categories, tags, menus and media, from its export file or its address: in Site Settings → WordPress, with `goodfellow import wordpress` and `goodfellow-next import wordpress`, or when creating a site with `create-goodfellow --wordpress`. WordPress's blocks become Goodfellow's built-in blocks, posts become a collection of Markdown items, and old addresses send visitors on to the new ones.
- 11d4f6a: More for sites in several languages. Header & Footer picks a language and gives it a header or footer of its own. The page and item editors have a language menu that opens their translations, or makes one. The site checks suggest translating pages and items that have no translation or an out-of-date one, when a publish brings them, and builds list them. Events and stories say their language in their structured data. In Next.js, the header and footer stay in the shared layout, one for each language, and the browser shows the page's.
- 564d1dc: Sites rebuild overnight only when visitors would see something new. Every build writes `goodfellow-build.json` with what it was built from and when what it shows by today's date next changes, and the starters' setups run `goodfellow nightly` (or `goodfellow-next nightly`) first each night, building only when there are fixes to install, something dated has changed, or the live site isn't the newest build. On GitLab Pages, a night with nothing new publishes the live site's files again. The Updates screen lets owners choose to rebuild overnight only when something changed, every night or never, and has Rebuild now. On GitHub the choice is the `GOODFELLOW_NIGHTLY` repository variable, which the sign-in service's owners' app now asks for the Variables permission to set.
- 0b4972a: Site checks on rendered pages, finishing roadmap step 26. Publishing warns about images without a description, headings that skip a level and links whose text, such as "Click here", doesn't say where they go, on the pages it changes as they'll show. `goodfellow build`, and `goodfellow-next finish` for Next.js sites, check every built page for those and with axe-core's accessibility rules, explained in plain words, and say that automated checks find only some problems. Core's new `@goodfellow-cms/core/accessibility` entry has `checkBuiltPages()` and `reportSiteProblems()`, and `renderedProblems()` is in the main entry.
  
  Blocks' output is more accessible: the Image block has an "Only decoration" setting; logos beside the site's name and Collection list's pictures are marked as decoration; Collection list's item titles are level 2 headings when the list has no heading of its own, and Calendar's days are level 2; photo credits are no longer an `<aside>` inside the page's main content.
- 200f868: Safer builds on GitHub: every job in the starters' workflows, and in the ones new sites get, has only the permissions it needs. The jobs that run the site's code can only read the repository and keep no credentials in it, and the nightly update builds the site before a separate job, which runs none of its code, publishes it (`goodfellow update --commit`). Sites' `.npmrc` turns off packages' install scripts. The admin panel's page has a Content Security Policy that keeps its frames on the editor's pages. Existing sites can copy the starter's `.github/workflows/` and `.npmrc` to get the same.
- 74bb2ad: Scheduled publishing: pages and collection items can be shown from a time and hidden after one (`showFrom` and `hideAfter` in their files, in the site's time zone), which builds, `goodfellow dev` and Next.js apply, leaving menus' links to them out until they're shown. The admin panel schedules pages from the Pages screen and items in their editor, lists what's coming up, and warns that scheduled content can be read early on a public repository. On GitLab it adds a pipeline schedule at each time, so changes go live then; the starters' new `.github/workflows/scheduled.yml` checks each hour with the new `goodfellow due` command and builds the site only when something has come due. Letting editors publish on GitLab now lets Developers merge too, which adding those schedules needs.
- 91b9a4c: Search engines and feeds: pages carry schema.org structured data (the site and its organization on the home page, events with their times and places, and dated items as articles), and collections whose items have pages and a date, such as news, get RSS and Atom feeds at `/feeds/<collection>.rss` and `.atom`, which every page links to. Both need the site's address. A page's settings can hide it from search engines, which also leaves it out of the sitemap, and the page editor shows how links to the page look when shared. `sendCalendarFile()` in `@goodfellow-cms/core/node` is now `sendBuildFile()`, which serves feeds too.
- 22ab254: Builds copy the site's Google Fonts into it: `goodfellow build` and `goodfellow-next finish` write them, with Google's stylesheet, into `fonts/google/`, and point every page at them, so visitors' browsers load them from the site without connecting to Google. Where Google can't be reached during the build, pages keep loading them from Google, and the build says so. For a site in a subfolder, such as `your-name.github.io/your-site/`, builds also say that search engines read `robots.txt` only at the domain's root, and how to have them find the sitemap.
- 884a0be: Sites in several languages. Add languages in Site Settings → Languages, each with the site's name and description in it; its pages go under its code, such as `/es/about`. The Pages screen and collections' lists translate pages and items into each language, say when a translation is out of date, and the AI assistant can translate a page or item. Each language can have menus of its own, the new Language switch block links to the page in each language, and pages say their language, link to their translations with `hreflang`, and are listed with them in the sitemap. Search finds only pages in the page's own language, and lists, feeds and calendars show only that language's items.
- f9a405e: The token broker: a sign-in page on an address of its own, released as `@goodfellow-cms/broker`, which keeps editors' GitHub or GitLab sign-in and AI keys, shows the admin panel in a frame and makes every call to the git host and AI services for it, so nothing on the site's address can read them. It asks the editor in its own part of the page before publishing the site's code, custom code or a new Site address, installing a release or giving someone access, never changes workflows, and asks for owner tokens itself. The config's new `broker` line, which Site Settings' Security tab sets, makes the admin panel open only inside the broker, which the sign-in worker then gives tokens to alone. With a broker, the Blocks screen offers the config's other registries too. The admin address's guard and header rules let the broker frame the admin panel.

### Patch Changes

- 93c5b2c: Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.
- Updated dependencies [043358b]
- Updated dependencies [938e468]
- Updated dependencies [e819602]
- Updated dependencies [ba80f97]
- Updated dependencies [e62801d]
- Updated dependencies [38dcc3a]
- Updated dependencies [9b96dd3]
- Updated dependencies [1590ea2]
- Updated dependencies [78d29e5]
- Updated dependencies [11d4f6a]
- Updated dependencies [564d1dc]
- Updated dependencies [93c5b2c]
- Updated dependencies [0b4972a]
- Updated dependencies [2901de0]
- Updated dependencies [8ac5d0e]
- Updated dependencies [200f868]
- Updated dependencies [74bb2ad]
- Updated dependencies [91b9a4c]
- Updated dependencies [fd00d26]
- Updated dependencies [22ab254]
- Updated dependencies [93fb9fa]
- Updated dependencies [884a0be]
- Updated dependencies [31217e1]
- Updated dependencies [f9a405e]
- Updated dependencies [e1e236d]
  - @goodfellow-cms/core@0.5.0
  - @goodfellow-cms/admin@0.5.0
  - @goodfellow-cms/react@0.5.0
  - @goodfellow-cms/ai@0.5.0

## 0.4.0

### Minor Changes

- 72607c8: A site's content can be kept in a repository of its own (roadmap step 25), so editors' sign-in, publishing and a full-stack site's server can change the content but never the code.
  
  - `github({ repo, contentOnly: true })` and `gitlab({ project, contentOnly: true })` point the admin panel at a repository that holds only `content/` and `public/media/`. Backends refuse to write anything else (`CodeChangeError`), and so does a full-stack site's API. The admin panel has no Blocks screen there, since adding a block changes the code, and its Updates screen says updates run where the code is.
  - `goodfellow content link` and `goodfellow-next content link` link `content/` and `public/media/` to the content repository in `content-repository/`, so `goodfellow dev` and `next dev` read and save its files; `content copy` copies them instead, as builds do. The dev servers and builds say what to run when the content hasn't been put in place.
  - `npm create goodfellow` asks where the content should be kept, or takes `--content your-name/your-site-content` and, on Vercel, `--build content|code`. It makes both repositories, with setup files for each: GitHub Pages and GitLab Pages build the site from the content repository, which checks out the code, while the code's repository runs the nightly update and asks for a rebuild after each change to the code; Vercel builds from either.
  - The Next.js starter's GitHub Pages and GitLab Pages setups now build with `npm run build`, so they run `goodfellow-next finish out` too, which writes the search index, calendar files and redirect pages.
- 4caf245: Full-stack Next.js sites (roadmap step 24): a Next.js app with a server of its own can be a Goodfellow site whose editors sign in with the app's own sign-in, while its server reads and publishes through GitHub or GitLab with one token that never reaches a browser.
  
  - `goodfellowApi()` from `@goodfellow-cms/next/server` is the admin panel's API, as a catch-all route. The app's `authorize(request)` says who's signed in and whether they're an `editor` or an `owner`; only owners change Site Settings, blocks, and collections' settings and templates, which the server checks on every write. Commits name the editor as their author.
  - `<GoodfellowAdmin server="/api/goodfellow" />` signs in through the app, and `withGoodfellow(config, { server: true })` builds for a server instead of static files.
  - `ai: { anthropic: process.env.ANTHROPIC_API_KEY }` sends the AI assistant's requests through the server with the site's key (`aiServer()` in `@goodfellow-cms/ai`), so editors don't need keys of their own.
  - `github()` and `gitlab()` have `server({ token })`, and core's `appApi()` (in `@goodfellow-cms/core/node`) is the API for other frameworks.
  - Calendar files and search are static on full-stack sites too: `goodfellow-next finish --server`, after `next build`, writes the calendar files into `public/calendars/` and indexes the pages Next.js rendered into `public/pagefind/`.

### Patch Changes

- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
- Updated dependencies [e8cd390]
  - @goodfellow-cms/core@0.4.0
  - @goodfellow-cms/admin@0.4.0
  - @goodfellow-cms/ai@0.4.0
  - @goodfellow-cms/react@0.4.0

## 0.3.0

### Minor Changes

- 6532990: Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token. A site's config can stop Claude publishing with `claude: { publish: false }`, so it only submits its changes for review. Claude sees the media library's sizes and credits, and can look at its images in screenshots. The GitHub and GitLab backends say how large files are without reading them (`fileSizes()`).
  
  For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.
- ace4b9c: A Dark mode switch block lets visitors choose light or dark colors on sites with dark mode, as a switch (with or without the words Light and Dark) or a menu that can also follow their computer. Their choice is kept in their browser and put back before each page shows. Sites choose their code colors in Site Settings → Colors & fonts → Code colors, from Shiki's color schemes for light and for dark, and can show code on the site's subtle background color. Code on light-only sites now carries only its light colors.
  
  The Dark mode switch shows the page's colors from the start, rather than the sun until its script runs. Pages preload their text and heading fonts' files, read from Google Fonts when the site is built (`fontPreloads()`), so the browser fetches them alongside Google's stylesheet rather than after it, and the stand-in font rarely shows. A build that can't reach Google goes on without preloading. While a font loads, pages show stand-ins made with [Fontaine](https://github.com/unjs/fontaine): the computer's own fonts of the same kind, resized to take the same space, so text barely moves when the font arrives.
  
  Next.js sites made from the starter before this need `suppressHydrationWarning` on `<html>` in `app/layout.tsx` to use the Dark mode switch without a warning in `next dev`.
  
  Sites' fonts fall back to the computer's own fonts of the same kind, such as a serif for Fraunces, rather than always to a sans serif. Site Settings saves each font's kind (`theme.fonts.headingCategory` and `bodyCategory`) when it's chosen; fonts chosen before keep falling back to a sans serif until they're chosen again.
- 7e618c6: Dark mode for sites, which their owners turn on in Site Settings → Colors & fonts: sites stay light only until then. Every theme color has a dark one, pages follow each visitor's light or dark setting, and a site can have a second logo for dark backgrounds. The admin panel's previews show the site light or dark, like the admin panel or as chosen on the Theme tab, and Claude's screenshots can show it dark. Code blocks can be colored like the page, which new ones are, and code in Markdown is too. Blocks' `dark:` classes now apply only on sites with dark mode, so a light-only site never turns partly dark on a computer set to dark.
  
  The Claude Desktop extension is now packed without Anthropic's `mcpb` tool, and the connector no longer installs Puppeteer's browser downloader, leaving out packages with security advisories.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0
  - @goodfellow-cms/react@0.3.0
  - @goodfellow-cms/admin@0.3.0

## 0.2.0

### Minor Changes

- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- 30c5903: Redirects: the page at an old address now says where it's sending visitors, with a link named after the page, in words the Redirects tab can change, and replaces itself in the browser's history, so Back no longer needs pressing twice. On Vercel, Vercel sends the redirects itself: new sites have a `vercel.ts` in place of `vercel.json` that reads them, and Next.js sites get them from `withGoodfellow()`. Redirects from addresses that pages have are left out, so pages still win.
- 8ea3680: Redirects: Site Settings has a Redirects tab for sending visitors from old addresses to new ones, and changing a page's address adds a redirect from its old one. Builds write a page at each old address that sends visitors on at once, which works on every host, `goodfellow dev` and `next dev` follow them too, and `goodfellow-next finish` writes them into Next.js exports.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- d09a681: Automatic updates: `goodfellow update` (and `goodfellow-next update`) updates a site to Goodfellow's newest fixes, or a release it's given, with the Puck version that release uses, and updates blocks from Goodfellow's registry, replacing only files nobody changed (`planUpdate()`). It publishes the update only once the site installs and builds with it, and otherwise puts everything back. The starters' GitHub Pages and GitLab Pages setups run it each night. **Site settings → Updates** shows the site's release, fixes and newer releases, and the last update, installs fixes now, lets owners install a newer release, and on GitLab turns on job token pushes and a nightly schedule. Owners can turn automatic fixes off and go back to the previous release, which updates then skip until it's allowed again; these settings live in a new content file, `content/updates.json`. Backends gain an optional `updates` capability; the GitHub owner token can now run workflows.

### Patch Changes

- 84cfc23: The admin panel's tab shows the site's icon, as its pages do, instead of the browser's default: the admin page names it before the admin panel loads, and the admin panel follows a new icon as soon as it's published, even before the live site has been rebuilt with it. Next.js sites show it in the sign-in screen too by using `site.adminMetadata()` in `app/admin/layout.tsx`, as the starter now does.
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
- Updated dependencies [84cfc23]
- Updated dependencies [f776202]
- Updated dependencies [caa6d55]
- Updated dependencies [2c07c71]
- Updated dependencies [c8a935e]
- Updated dependencies [4000e48]
- Updated dependencies [0e97dd2]
- Updated dependencies [03dc28f]
- Updated dependencies [4b44513]
- Updated dependencies [c97095c]
- Updated dependencies [b61d3f2]
- Updated dependencies [699e0dd]
- Updated dependencies [b55c95c]
- Updated dependencies [ed49c5e]
- Updated dependencies [30c5903]
- Updated dependencies [8ea3680]
- Updated dependencies [66d7d1c]
- Updated dependencies [a210b23]
- Updated dependencies [8176568]
- Updated dependencies [a5fe669]
- Updated dependencies [d09a681]
- Updated dependencies [7785ef5]
- Updated dependencies [8f9eff2]
  - @goodfellow-cms/admin@0.2.0
  - @goodfellow-cms/core@0.2.0
  - @goodfellow-cms/react@0.2.0

## 0.1.0

### Minor Changes

- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- 2af75b7: Site settings has a Code tab for code from services such as Google Analytics: "In the page head" (script, style, link, meta, base and noscript tags, read with `parseHeadCode()`) and "At the end of the page" (any HTML), saved as `content/code/head.html` and `content/code/body.html`. `goodfellow build` and Next.js add it to every page with `HeadCode` and `BodyCode`; it never runs in the admin panel.
- 88ac239: Demo mode. A site whose config sets `demo: true` opens its admin panel to anyone, with no sign-in and a banner saying it's a demo. Visitors can try everything editors can, but nothing is published: Publish saves their changes, uploads included, in their own browser (IndexedDB), where they stay until the visitor clicks Start over. The Blocks screen lists blocks without adding or removing them.
  
  The demo starts from a copy of the site's content that builds include at `/admin/demo-content.json`, so no git host is called and the repository can stay private. `goodfellow build` writes it, along with the admin panel, for demo sites; Next.js sites serve it with `demoContent` from `goodfellowPages()`, in a new `app/admin/demo-content.json/route.ts`. `@goodfellow-cms/core` adds `demoContent()`, `demoStore()` and the config's `demo` option.
- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- 04fc203: The Next.js starter shows the header and footer in a layout (`app/(site)/layout.tsx`, from `goodfellowPages().Layout`), so they stay as they are when moving between pages, and pages only send their own content. `@goodfellow-cms/react` exports `PageHeader`, `PageContent`, `PageFooter` and `prepareLayout()`. Menu marks current links with `data-current` and `aria-current`, which Next.js's layout sets in the browser, since it doesn't know the current page. In `next dev`, `withGoodfellow()` turns off React's debug channel, which made the browser's memory grow to gigabytes with the header and footer in a layout.
- ebe8d1d: `goodfellow-next finish out`, which the Next.js starter's build script now runs after `next build`, writes the search index as `goodfellow-next index` does, and on Windows moves Next.js's prefetch files to where browsers ask for them. Next.js 16 writes them into `__next.…` folders there, so every prefetch while moving between pages was "not found". `fixSegmentFiles()` is exported from `@goodfellow-cms/next/export`.
- de03c18: Add `@goodfellow-cms/next`, which puts a Goodfellow site in a Next.js app, exported as static files. Pages render as Server Components; blocks' links to the site's pages use `next/link` and images `next/image`, sites can be served from a subfolder (`basePath` or `GOODFELLOW_BASE`), and blocks can render Client Components with any hooks. In `next dev` the admin panel saves to the files on disk. `create-goodfellow` can start from a Next.js version of the starter (`--template next`).
  
  `@goodfellow-cms/react` gains a Server Components version (picked through the `react-server` condition), `preparePage()`, and `SiteLink` and `SiteImage`, which blocks use for links and images so they follow the site's base path and the renderer's components. The built-in blocks use them. `@goodfellow-cms/core` gains `withBase()`, `applyBasePath()` and `imageSize()`, and `@goodfellow-cms/core/node` reading sites from disk, image sizes, the local file store and the development API.

### Patch Changes

- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
- Updated dependencies [1d4191f]
- Updated dependencies [1414af7]
- Updated dependencies [fd6f851]
- Updated dependencies [b4b80a6]
- Updated dependencies [2e85621]
- Updated dependencies [5492e22]
- Updated dependencies [2af75b7]
- Updated dependencies [ce5faee]
- Updated dependencies [88ac239]
- Updated dependencies [652b180]
- Updated dependencies [1bfecf7]
- Updated dependencies [405de70]
- Updated dependencies [c7ab18e]
- Updated dependencies [809001e]
- Updated dependencies [ece9ba5]
- Updated dependencies [536f2a8]
- Updated dependencies [04fc203]
- Updated dependencies [de03c18]
- Updated dependencies [4ca2dc1]
- Updated dependencies [d91eea1]
- Updated dependencies [56dbc36]
- Updated dependencies [8c69eb5]
- Updated dependencies [cff2c58]
- Updated dependencies [3a4c60d]
  - @goodfellow-cms/admin@0.1.0
  - @goodfellow-cms/core@0.1.0
  - @goodfellow-cms/react@0.1.0
