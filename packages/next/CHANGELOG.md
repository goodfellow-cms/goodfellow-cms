# @goodfellow-cms/next

## 0.10.0

### Minor Changes

- cfa0a83: Setting up one-click sign-in no longer needs a developer.
  
  - **Sign in with GitHub:** the sign-in service is put online from the browser, with Cloudflare's Deploy to Cloudflare button. The deployed service's own setup page, at `/setup`, takes a Cloudflare API token once, made from a link that fills it in, with the sites' addresses. It saves its settings in Cloudflare and makes its two GitHub Apps with the owner, never keeping the token. Copies update themselves each week from create-goodfellow on npm, which now carries the service as `templates/sign-in/`.
  - **Naming the service:** Site Settings → Security has a **Sign in with GitHub** section. It checks the service is set up and publishes its address in the site's config.
  - **GitLab and Bitbucket:** the same section walks owners through GitLab's application form or Bitbucket's consumer form, with every value to copy. It then publishes the Application ID or the consumer's Key.
  - **Content repositories:** for sites whose content is kept in a repository of its own, `goodfellow sign-in service <address>`, `goodfellow sign-in client-id <id>` and `goodfellow sign-in remove` do the same, with `goodfellow-next sign-in` for Next.js sites.
- 86b7c5d: Export a site as a folder of Markdown files, for Hugo, Jekyll, Eleventy, Astro, notes apps and AI tools: each page and collection item at its address with YAML front matter, the media library and the menus. Site Settings → Import / Export has **Export as Markdown**, which downloads a zip, and `goodfellow export markdown` and `goodfellow-next export markdown` write a folder. Links keep the site's addresses, or link to the files with `--links files`. Layout, the header and footer, and blocks Markdown can't hold, such as forms and calendars, are left out and listed. The WordPress export now gives images without alt text of their own the media library's description.
- 378dd68: Move content between Goodfellow sites with nothing lost. **Export for another Goodfellow site** on Site Settings → Import / Export, and `goodfellow export site`, download the same zip as Download a copy, which now includes `goodfellow-transfer.json`. **Import from another Goodfellow site**, and `goodfellow import site`, bring it into another site. They either add to its content, with a choice for each thing both sites have differently, or replace its content. The Site address, editors' limits, update settings and media storage always stay as they are. Blocks the export used from Goodfellow's block registry can be added in the same publish.

### Patch Changes

- Updated dependencies [cfa0a83]
- Updated dependencies [93fdd74]
- Updated dependencies [cdc5103]
- Updated dependencies [20babd9]
- Updated dependencies [86b7c5d]
- Updated dependencies [378dd68]
  - @goodfellow-cms/core@0.10.0
  - @goodfellow-cms/admin@0.10.0
  - @goodfellow-cms/ai@0.10.0
  - @goodfellow-cms/react@0.10.0

## 0.9.0

### Minor Changes

- 0177574: The admin panel speaks any language a site has its text in: `content/admin-text/<code>.json` holds its words, Puck's and blocks' labels, each with a hash of the English it was made from, and the language menu offers it beside English and Spanish. Every string is checked as it's used, falling back to English where it's empty, too long or has other placeholders than the English, and the English is shown beside the site's own words for signing in, tokens, owners' screens, plugins and what can't be undone. Only owners change the files. `goodfellow build` and `goodfellow-next finish` publish them beside the admin panel, in `admin/text/`, so the sign-in screen speaks them too; full-stack Next.js sites get them in `public/admin/text/`, which the starter's `.gitignore` now leaves out.
- 19d7812: Owners can install an update of a plugin or theme the site has before it's three days old, with **Install now**, where both the version installed and the new one have npm provenance from the same repository and workflow. First installs, releases without provenance and releases built anywhere else still wait, and waiting stays the default. Where the site is built, the check is made again with Sigstore's signatures: the lockfile job (through `goodfellow-early`, run from npm) for plugins, `goodfellow build` and `goodfellow-next finish` for themes, and the full-stack server before review, failing loudly rather than falling back. The token broker names the release's repository in its own dialog. The starters' workflows have the new lockfile step, and their builds don't run after the lockfile job fails.
- bd82b21: Import a folder of Markdown files, such as another static site's content: Site Settings' Import tab (formerly WordPress) and `goodfellow import markdown <folder>` (`goodfellow-next import markdown`) bring each folder in as pages or a collection, with links between the files at their new addresses, the pictures beside them copied into the media library, front matter as pages' settings and items' fields, and redirects from addresses that changed. `planMarkdownImport()` in `@goodfellow-cms/core/wordpress` plans it with no disk or network access.
- d345032: The media library's **Details** keeps an image's focal point in view wherever it's cut to fit, on images and Section backgrounds, and gives files tags, which filter the Media screen and the image picker; several files can be tagged at once. Photos can be cropped and turned in the browser, saved as a new image or in place of the original. Builds' smaller copies of photos are now WebP, about a third smaller. `content/media.json` gains optional `focus` and `tags`, and `mediaDetailsOf()` reads all of it for `mediaFileChange()`.
- 8dcf967: Use fonts of your own: Colors & fonts' new Add a font uploads a font's WOFF2 files, checked in the browser, once the owner confirms its license allows websites, and the font menus offer it first. Pages load it from the site with `@font-face`, preloading the text's and headings' files, with size-matched stand-ins measured from the files, and the admin panel's editor and previews show it from its bytes.
- cf403e0: Plugins' tasks run in two parts, so the site's code never runs where their secrets are. Loading a site's config runs every package it imports, plugins' own included, and on Linux a process can read the environment its parent started with, so a package could read every secret of the job that ran a task. Now `goodfellow task --describe` (and `goodfellow-next task --describe`) loads the config in a job with no secrets and writes the task down, and the job with them installs Goodfellow's task runner from npm apart from the site's packages, installs those without running their scripts, and runs the new `goodfellow-task` bin of `@goodfellow-cms/core`, which never loads the config and checks what was written down: the task must be the plugin's own module, ask for none of the hosts' own variables, and for a plugin installed from the Plugins screen ask for no more than its owner approved.
  
  The starters' `plugin-task.yml`, `.gitlab-ci.yml` and the Bitbucket and Cloudflare setups `planSite()` writes are the new ones. On GitLab, scope plugins' variables to the `goodfellow-tasks` environment so only the task's job has them; Bitbucket gives every step every repository variable. Sites made before this run tasks in one job until a developer copies the starter's task setup, since updates can't change a site's workflows.
  
  The lockfile jobs' early-update check now refuses a `package.json` that names `@goodfellow-cms/core` as anything but a release from npm, such as a URL or a git repository, which `npm exec` would otherwise install and run.
- 0b22859: Pages can ask search engines not to follow their links or show their text, and choose a large or small picture when shared. Every page lets search engines show its pictures large, and link previews name the site, the page's language, the picture's description and size, and a dated item's date. Site Settings can ask AI companies' training crawlers to leave the site alone. Pages' full addresses (canonical links, the sitemap, feeds and the rest) now end with a slash, as most hosts serve the folders builds write, and so do links between pages, so following one needs no redirect; a site whose host serves them without one sets `trailingSlash: false` in its config, or Next.js's own. The docs say how to host a site anywhere, such as on AWS, Google Cloud or DigitalOcean, and the Domain screen explains connecting a domain on any host.
- 1023c64: Count visits with Plausible, Umami or GoatCounter: Site Settings' new Visit counts screen reads the service's code, adds its script to every page (waiting for visitors to allow statistics on a site that asks them first, unless the owner says it needn't), and links to the service's dashboard.

### Patch Changes

- 19d7812: The nightly update's publish job publishes only what an update changes, with packages only from npm's registry; plugins can't ask for CI services' and hosts' own variables; the token broker asks before showing the admin panel from a new address, and can be held to one in `broker.json`; and the sign-in worker revokes a code repository's token whatever stops it being given.
- d0a47cb: Packages' npm descriptions, and the Claude Desktop extension's name, say Goodfellow CMS, the official name, so they're easier to find.
- 9c6cb6f: Harden more of what the code review found:
  
  - Builds read other calendars and News feed blocks' feeds only from `https://` addresses that aren't on the building computer or a private network, checking each redirect, and stop reading past their size limit as they read (`readRemoteText()`, `isPrivateHost()`).
  - Markdown headings never get an id starting `gf-`, which Goodfellow's own scripts look up, so a heading can't stop a page's interactive blocks from starting.
  - Calendar files never let a carriage return in a name or event start a line of its own; sitemaps escape `"` in addresses.
  - Players and social posts refuse every spelling of this computer's address (`localhost.`, `*.localhost`, `[::ffff:127.0.0.1]`).
  - Registry items' files go only into their own block's folder or the shared components, whatever their `target` says.
  - Next.js sites' redirects to addresses with `:`, `*`, `(` and the like no longer fail `next build`.
  - `next dev`'s local server refuses requests for any name but this computer's before serving the editor's frames, reading the name Next.js passes on as `x-forwarded-host`.
  - Sites that ask visitors first also hold back head styles that load from other sites, a `base` and a `meta` refresh.
  - Apps download a kept file again where it's corrupt, keep the classes they can read where twrnc can't read one, and keep other sites' frames from opening other apps; on Android, links from them now open in the browser.
  - GitLab's "let editors publish" changes the branch's protection in one step where GitLab can, and checks it after where it can't.
  - Local screenshots never let a site's scripts write through the development server's API.
- 19d7812: Front matter ends only at a line of its own `---`; moving a page re-points redirects to it however they write its address; languages with capitals, such as pt-BR, can have their own item addresses; structured data gives a time clocks skip as the instant it is; an event can't stop repeating before it starts, and a daily event from long ago shows its next day; `goodfellow due` reads a copy's own build record and, the first time, looks back to when the live site was built; `goodfellow-next finish` reads what `next build` wrote wherever the config's `distDir` puts it; scheduled builds are kept in step with the live site only, never a draft, and stale ones are removed once the admin panel loads; and the Updates screen waits for the run it started before showing how it went.
- 19d7812: Full-stack sites' servers check what they're sent as the admin panel does: media must be a kind the site can use by the name it's saved under, and SVGs already cleaned; pages sent as bytes are read as text; a block an owner set to be used exactly as written is the owner's whole, and two blocks with one id are refused; editors may add and remove media storage's files but not move it; and settings submitted for review are owners' too. SVG cleaning keeps out more ways of spelling another site's address (`/\host`, `URL(`, CSS escapes in any attribute, `image-set()`), and media SVGs are sandboxed however their extension is spelled. The Next.js starter has a `vercel.json` that turns off previews of drafts' and tasks' branches, which updates add to older Next.js sites.
- Updated dependencies [1004f6f]
- Updated dependencies [8b2322e]
- Updated dependencies [0177574]
- Updated dependencies [0177574]
- Updated dependencies [d345032]
- Updated dependencies [e7dd766]
- Updated dependencies [19d7812]
- Updated dependencies [58556ef]
- Updated dependencies [b4f074a]
- Updated dependencies [cde2373]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [bff0a8a]
- Updated dependencies [d0a47cb]
- Updated dependencies [78f1f14]
- Updated dependencies [15ef491]
- Updated dependencies [1004f6f]
- Updated dependencies [bd82b21]
- Updated dependencies [78f1f14]
- Updated dependencies [d345032]
- Updated dependencies [181d734]
- Updated dependencies [8dcf967]
- Updated dependencies [cf403e0]
- Updated dependencies [9c6cb6f]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [0b22859]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [cb72911]
- Updated dependencies [dfd7ea3]
- Updated dependencies [01b7691]
- Updated dependencies [1023c64]
- Updated dependencies [78f1f14]
  - @goodfellow-cms/admin@0.9.0
  - @goodfellow-cms/ai@0.9.0
  - @goodfellow-cms/core@0.9.0
  - @goodfellow-cms/react@0.9.0

## 0.8.0

### Minor Changes

- a341e5f: Sites with an admin address on Vercel now send pages opened at the wrong address to the right one before they load: a site page opened at the admin address goes to the Site address, and, once the address is checked, the admin panel opened at the Site address goes to the admin address. Only pages opened in a tab are sent, so the admin panel's previews and what pages load stay where they are. The starters' `vercel.ts`, `withGoodfellow()` and content repositories' `vercel.ts` (`withVercelAdminAddress()`, kept in step by `goodfellow admin`) add them, from `vercelAdminRedirects()`. The docs give Cloudflare redirect rules that do the same on Cloudflare Pages. Existing sites on Vercel get them by copying the starter's `vercel.ts`.
- 90e3369: The built-in blocks no longer need React in visitors' browsers. The Code block's copy button, the Dark mode switch and the Search box are plain HTML, each made to work by a small script of its own in `@goodfellow-cms/core` (`copyScript()`, `darkModeScript()`, `searchScript()`), which `goodfellow build` adds only to the pages that use it (`blockScriptsFor()`) and Next.js sites' layout has all of. A page made of built-in blocks now loads no React at all, about 70 kB less on pages with search or a Dark mode switch. `CodeView` no longer takes `code`: the copy button copies the `<pre>` beside it. Search results are plain links, which Next.js sites' layout opens with Next.js's navigation and loads ahead, as `next/link` does.
- 5869562: Builds make smaller copies of the media library's photos, 480, 800, 1200 and 1600 pixels wide, and images list them in `srcset`, so phones download no more than they show. `goodfellow build` and `goodfellow-next finish` (for static exports without an image loader of their own) write them into `media-sizes/`. Base paths now also apply to `srcset` as React spells it.
- 5e9a95b: Sites can ask visitors before showing content from other sites. With **Site Settings → General → Visitors' consent** on, a notice at the bottom of each page asks, and until visitors agree, YouTube, Vimeo and other sites' players, Google forms and maps load nothing and show a note with a button in their place, hCaptcha waits, and the site's custom code (all of the end of the page's, and the head's scripts, links and `noscript`) waits too. The answer is kept in the visitor's browser, links to `#consent` open the notice again, and every word of it can be changed, in each of the site's languages.

### Patch Changes

- 2e22322: Fixes to asking visitors before loading other sites' content:
  
  - The head's links to the site's own files, such as a stylesheet or icons, stay on the page; only links to other sites wait for visitors to agree (`isHeldHeadElement(element, siteUrl)`).
  - Code that has `</template>` in it, which would run before visitors agree, is left out of pages while the site asks. Site Settings won't publish it, and Custom HTML used as written is made safe instead (`endsHeldTemplate()`).
  - The consent script finds the notice by `data-gf-consent-notice`, so an element in rich text with the same id can't hide it. The notice is named by its message for screen readers, and a link to `#consent` moves the keyboard's focus to it.
  - The notice's words come in the site's main language where there are default words for it (English and Spanish), and each language's pages get their own default words (`consentDefaults()`, `consentInLanguage()`). Turning asking off and on again keeps the words that were written.
  - Google forms and maps keep their Style on the box around them, in the editor and on the site alike (`ConsentFrame`'s `boxClassName`).
  - The docs say that full-stack Next.js sites load fonts from Google before visitors agree.
- 293bbf0: Visitors' consent asks about kinds of content: other sites' content, and statistics and advertising where Site Settings → Code says the site's code is for them. Visitors can allow each kind on its own from the notice's Choose, and code marked as needed for the site to work loads without asking. A visitor's answer now lasts as many days as Site Settings says (180 by default, at most 395), and the notice asks again once it's older, or when the site asks about a kind it didn't before. Answers kept by earlier releases are asked again once.
- 368f04e: On full-stack Next.js sites, only owners can choose to use Custom HTML exactly as written, which runs it on the site. Editors see the setting but can't change it, and the site's server refuses a publish that changes it or adds the block with it. Blocks of a site's own can mark settings like that with `metadata: { owners: true }` (`ownersOnlyFields()` and `ownersOnlyChanges()` in `@goodfellow-cms/core`, `AppApiOptions.ownersOnly`).
- 65239e6: Editor plugins' frames show the site's media as the standard editor does: from the site's folder on a site in a folder of its domain, from memory for a picture just uploaded that the site doesn't have yet, and from the storage a plugin keeps the site's media in, whose address their frames may now load images and videos from. Text edited in place keeps content's `/media/` addresses. Plugins can tell from `session.showsMedia` and leave the addresses as they are.
- 676ab5c: Menus work on phones. The Menu block's **Show the links behind a menu button (☰)** shows every link, every level of them, under a button on phones, on phones and small tablets, on phones and tablets, always or never, with no JavaScript; the editor says when a menu's submenus can't be reached on phones because it never shows the button. The starters' and the example's headers show it on phones and small tablets. In Next.js sites, the menu button's links close after moving to another page.
  
  The admin panel works in narrow windows: its links, View site and the account are under a menu button there, and a Dark mode switch takes the place of the list of colors.
- 4744a5f: Full-stack Next.js sites submit owners' changes to the site's code, such as adding blocks on the Blocks screen, for review by default, since their server runs that code with its token and keys; `goodfellowApi({ codeChanges: "publish" })` lets owners publish them. The sign-in service says the app isn't installed as soon as it's uninstalled, rather than that signing in isn't working. New sites' setup asks whether you have a domain, starts with an admin address where you do and the host can serve one, and otherwise recommends a sign-in page of its own; the Security and Code tabs say when editors' sign-in is within reach of the site's pages.
- 86ad949: Security fixes from a review:
  
  - The token broker refuses calls it doesn't list, and asks before changing domains, taking someone's access away, running a plugin's task, setting up updates or throwing away a draft. It also never publishes `bitbucket-pipelines.yml`.
  - `goodfellow task` and `goodfellow-next task` load the site's config in a process of its own that has none of the job's secrets, so the config and the packages it loads can't read them.
  - The GitHub backend lists every pending invitation and organization, not only the first 100.
  - GitLab removes a scheduled-change pipeline schedule it couldn't give its variable.
- 7be53b5: Sites on Cloudflare Pages and Vercel get safer headers: every file is sent with `X-Content-Type-Options: nosniff` and a referrer policy, the media library's SVGs open sandboxed, so they can never run as the site, and the admin panel can't be framed by another site and opens in a window the site's pages can't reach. Builds add the rules to `_headers` after the site's own; the starters' `vercel.ts` and `withGoodfellow()` give them to Vercel. A static site on Vercel from before this keeps its own `vercel.ts`: copy the starter's to get them.
- fcb4100: Full-stack Next.js sites (`withGoodfellow(config, { server: true })`) serve their Google Fonts themselves, as static exports do. `next build` copies them into `public/fonts/google/` before it renders any page, so pages rendered while it builds and while the site runs both point at the copies, and visitors' browsers never ask Google for them. Where Google can't be reached while building, the build says so and pages load the fonts from Google. New sites' `.gitignore` leaves out `public/fonts/google/`.
- Updated dependencies [a341e5f]
- Updated dependencies [911f778]
- Updated dependencies [8d9d46c]
- Updated dependencies [d21884a]
- Updated dependencies [f3e81fb]
- Updated dependencies [2e22322]
- Updated dependencies [9ccc5bb]
- Updated dependencies [293bbf0]
- Updated dependencies [46cf9d9]
- Updated dependencies [368f04e]
- Updated dependencies [b9f619e]
- Updated dependencies [65239e6]
- Updated dependencies [b072536]
- Updated dependencies [141a23d]
- Updated dependencies [ecfbab6]
- Updated dependencies [676ab5c]
- Updated dependencies [8622adc]
- Updated dependencies [90e3369]
- Updated dependencies [7a9a116]
- Updated dependencies [5869562]
- Updated dependencies [5113b06]
- Updated dependencies [4e12d00]
- Updated dependencies [1a25a31]
- Updated dependencies [e558acd]
- Updated dependencies [4744a5f]
- Updated dependencies [9731fc0]
- Updated dependencies [86ad949]
- Updated dependencies [7be53b5]
- Updated dependencies [fcb4100]
- Updated dependencies [51a992a]
- Updated dependencies [a10f9ae]
- Updated dependencies [5e9a95b]
- Updated dependencies [1335733]
  - @goodfellow-cms/core@0.8.0
  - @goodfellow-cms/admin@0.8.0
  - @goodfellow-cms/react@0.8.0
  - @goodfellow-cms/ai@0.8.0

## 0.7.0

### Minor Changes

- 3bb8c96: Builds write a content API at `/api/`: the site's content as static JSON, each page as it's shown after preparation, with each language's settings, menus, collections, header and footer, and a manifest listing every file with a hash, so apps and other sites can show the site without a server. Rich text and Markdown are written as sanitized HTML, as pages have them, and also as a simple structure an app can draw without an HTML renderer. `goodfellow build` and `goodfellow-next finish` write the same files, and the config's `api: false` leaves them out. Numbered lists that start past 1 keep their start when rich text is sanitized.
- cedcb3a: Editor plugins' frames are the editor's alone: they keep the admin panel's colors and font but no longer get a screen's spacing or plain element styles, which reached the site's blocks drawn in them. Their policy lets them load the theme's Google Fonts, as the standard editor's frames do, and `session.styles()` gives the fonts' stylesheet as `fonts`.
- 45a692b: Apps with Expo: `@goodfellow-cms/expo` shows a Goodfellow site natively in an Expo app for iPhone and Android from its content API, with no server. The app reads the manifest when it starts and when it comes back to the front, downloads only what changed and keeps it with its pictures, so it works offline; large sites choose which pages it keeps ahead. It stays on the copy it has when the site's content is newer than it reads. Every built-in block has a version for apps, `nativeBlocks` from `@goodfellow-cms/blocks/native`, sharing its props and what it shows with the website's, and blocks the app has no version of show a placeholder, or the app's own fallback, such as an Expo DOM component. `goodfellow blocks add --native <app>` also makes a block's version for the app with shadcn-tamagui-codemod. The content API's manifest now lists the site's redirects, which the app follows as the website does, and its pages carry their blocks' default props and the page's links to its translations, and the Form block has messages for the app to show once answers are sent or when they couldn't be.
- db58e5d: `goodfellow blocks add <item>` (and `goodfellow-next blocks add`) installs any shadcn registry item with shadcn's own CLI and makes a block of its component. Its fields come from the component's props, read with TypeScript 7, and its defaults from the component's code. The command then typechecks and renders the block, and lists what it couldn't do. With `--registry <folder>`, it writes the block into a block registry instead. The new `@goodfellow-cms/core/shadcn` entry does the work.
  
  New sites' `components.json` says `"rsc": true`, since with `false` shadcn drops `"use client"` from what it installs, and interactive components never run in the browser. The command fixes older sites' when it runs.
- a52b217: Staging copies of a site: a build with `GOODFELLOW_SITE_URL` uses that address in place of the Site address, and `GOODFELLOW_NO_INDEX=true` keeps every page out of search engines, without either one reaching content. The config's `copies` lists them for the sign-in service, through `goodfellow-site.json`. A copy at an address of its own keeps its admin panel there, and the Domain screen says where it is.

### Patch Changes

- Updated dependencies [c6afe19]
- Updated dependencies [a8e3581]
- Updated dependencies [48366cf]
- Updated dependencies [8f7fa14]
- Updated dependencies [4f79454]
- Updated dependencies [3bb8c96]
- Updated dependencies [cedcb3a]
- Updated dependencies [a50ae8f]
- Updated dependencies [42cf54b]
- Updated dependencies [45a692b]
- Updated dependencies [45a692b]
- Updated dependencies [45a692b]
- Updated dependencies [db58e5d]
- Updated dependencies [a52b217]
- Updated dependencies [dd3da3e]
- Updated dependencies [6701c92]
  - @goodfellow-cms/admin@0.7.0
  - @goodfellow-cms/react@0.7.0
  - @goodfellow-cms/core@0.7.0
  - @goodfellow-cms/ai@0.7.0

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
