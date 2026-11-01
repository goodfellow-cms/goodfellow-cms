# @goodfellow-cms/admin

## 0.9.0

### Minor Changes

- 1004f6f: Owners can edit the admin panel's words by hand on Site Settings → Admin panel languages: each language opens with every string's English beside what the admin panel shows, searchable and narrowed to what's not written, out of date, unusable or not read yet, with a mark for strings someone who speaks the language has read. English and Spanish open the same way, keeping only the words an owner changes over Goodfellow's own.
- 8b2322e: `@goodfellow-cms/admin/text` gives the admin panel's English with nothing to draw, for language packs' own checks: `goodfellowAdminTextSources()`, every string by its key, with Goodfellow's own blocks' labels (`BUILT_IN_LABELS`), and `languageStatus()` and `sourceState()`, which say what a language's file is missing, has out of date or can't use.
- 0177574: Owners can add a language for the admin panel and have it translated in Site Settings → Admin panel languages, with the AI service they choose, as in the editor's AI panel. The admin panel's words, the editor's controls and the site's blocks' labels are translated a batch at a time, with a glossary that keeps the admin panel's words the same throughout and plain, every answer checked before it's used, and what comes back published at once, even if the service stops part way. The screen shows how much each language says, and translates again what's missing or out of date. `@goodfellow-cms/ai` has `translateAdminText()`, `adminTextRequest()` and `readAdminTextAnswer()`.
- 0177574: The admin panel speaks any language a site has its text in: `content/admin-text/<code>.json` holds its words, Puck's and blocks' labels, each with a hash of the English it was made from, and the language menu offers it beside English and Spanish. Every string is checked as it's used, falling back to English where it's empty, too long or has other placeholders than the English, and the English is shown beside the site's own words for signing in, tokens, owners' screens, plugins and what can't be undone. Only owners change the files. `goodfellow build` and `goodfellow-next finish` publish them beside the admin panel, in `admin/text/`, so the sign-in screen speaks them too; full-stack Next.js sites get them in `public/admin/text/`, which the starter's `.gitignore` now leaves out.
- e7dd766: New blocks and more from the ones there are. Questions and answers shows questions that open to their answers, and tells search engines about them. The Announcement bar carries news across the top of every page between a first and last day, and visitors can close it until its message changes. Galleries open their pictures larger when clicked, with the arrow keys, buttons and swiping moving between them (new galleries start with it on). Heading blocks carry link names, which On this page now lists on any page, and it can stay in view as the page scrolls. Table cells can be bold, italic or links, which WordPress imports and exports keep. The registry's Map block also shows OpenStreetMap's maps.
- 58556ef: Collections have five more kinds of field: yes or no, links to items in a collection (one or several, renamed with the items they link to, taken out when one is deleted, and checked before publishing), several images, a file, and repeating groups of a few fields. Entry field shows each, Collection list and loop can show only items where a yes or no field is on, and, in a page design, only the items the page's item links to. The AI assistant fills in yes or no fields and links to items.
- b4f074a: Comments can be kept by Disqus, or by Garrul in the owner's own Cloudflare account, as well as by Giscus, so visitors without a GitHub account can comment: Site Settings' Comments takes a Disqus site's shortname or Garrul's address on any site, and the Comments block shows their comments, waiting for visitors' consent where the site asks.
  
  The Comments block offers Giscus's settings, reactions and where the box for writing goes, only for comments Giscus keeps, and editor plugins' sessions have `fields(block)`, which gives a block's settings as the site's code chooses them for its props, for blocks whose description says `resolvesFields`.
- cde2373: Site Settings → Site history has **Download a copy**, which downloads the site's content, its media library and the lists of the blocks and plugins it added as one zip file, named after the site and the day, read at the revision the admin panel loaded.
- 19d7812: Owners can install an update of a plugin or theme the site has before it's three days old, with **Install now**, where both the version installed and the new one have npm provenance from the same repository and workflow. First installs, releases without provenance and releases built anywhere else still wait, and waiting stays the default. Where the site is built, the check is made again with Sigstore's signatures: the lockfile job (through `goodfellow-early`, run from npm) for plugins, `goodfellow build` and `goodfellow-next finish` for themes, and the full-stack server before review, failing loudly rather than falling back. The token broker names the release's repository in its own dialog. The starters' workflows have the new lockfile step, and their builds don't run after the lockfile job fails.
- 78f1f14: The editor keeps unpublished changes in the browser as you type, and offers them back the next time the page, header, footer, design or item opens, so closing the tab, a crash or a sign-in that runs out doesn't lose them. Signing out forgets them.
- 15ef491: Keyboard shortcuts in the admin panel: Ctrl+S (⌘S on a Mac) adds an editor's changes to a draft, never publishing them; Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo in the editors from the admin panel's own header too; Ctrl+K opens **Go to…**, which finds pages, items, collections, synced blocks and screens by name; and `?` lists them. The editor's frame tells the admin panel's page only which shortcut was pressed.
- 1004f6f: Language packs: the admin panel's text in a language, shared on npm as `goodfellow-language-<name>` with no code, which owners find, install, update and remove on Site Settings → Admin panel languages. Installing one writes its words into the site's `content/admin-text/<code>.json`, keeping any the owner wrote or changed, and an update replaces only the pack's words nobody has changed since. Core adds `searchLanguagePacks()`, `languagePackReleases()`, `fetchLanguagePack()`, `planLanguagePack()` and the testing fakes `fakeLanguagePacks()` and `sampleLanguagePackFiles()`.
- bd82b21: Import a folder of Markdown files, such as another static site's content: Site Settings' Import tab (formerly WordPress) and `goodfellow import markdown <folder>` (`goodfellow-next import markdown`) bring each folder in as pages or a collection, with links between the files at their new addresses, the pictures beside them copied into the media library, front matter as pages' settings and items' fields, and redirects from addresses that changed. `planMarkdownImport()` in `@goodfellow-cms/core/wordpress` plans it with no disk or network access.
- 78f1f14: The media library describes images: **Describe** on the Media screen says what an image shows, in each of the site's languages, kept in `content/media.json`, and images whose blocks leave their description empty use it, on the site, in the editor and in apps through the content API's `site.json`. The Media screen's search finds files by their descriptions too, and **Select files** deletes several files in one publish. `mediaFileChange()` now takes `{ credits, descriptions }`, and `withoutCredits()` is `withoutMediaDetails()`.
- d345032: The media library's **Details** keeps an image's focal point in view wherever it's cut to fit, on images and Section backgrounds, and gives files tags, which filter the Media screen and the image picker; several files can be tagged at once. Photos can be cropped and turned in the browser, saved as a new image or in place of the original. Builds' smaller copies of photos are now WebP, about a third smaller. `content/media.json` gains optional `focus` and `tags`, and `mediaDetailsOf()` reads all of it for `mediaFileChange()`.
- 181d734: Netlify as a host, for sites on GitHub and GitLab: `create-goodfellow --host netlify` and the setup page write `netlify.toml` (which never builds drafts or plugins' tasks) and the nightly update and scheduled changes, which ask Netlify to rebuild through its build hook (`NETLIFY_BUILD_HOOK`). Builds on Netlify write header rules suited to it (`netlifySiteHeaders()`), an admin address works there with the guards alone, as on GitLab Pages, the Domain screen explains Netlify's domains, and the admin panel follows Netlify's deploys on GitHub.
- 8dcf967: Use fonts of your own: Colors & fonts' new Add a font uploads a font's WOFF2 files, checked in the browser, once the owner confirms its license allows websites, and the font menus offer it first. Pages load it from the site with `@font-face`, preloading the text's and headings' files, with size-matched stand-ins measured from the files, and the admin panel's editor and previews show it from its bytes.
- 0b22859: Pages can ask search engines not to follow their links or show their text, and choose a large or small picture when shared. Every page lets search engines show its pictures large, and link previews name the site, the page's language, the picture's description and size, and a dated item's date. Site Settings can ask AI companies' training crawlers to leave the site alone. Pages' full addresses (canonical links, the sitemap, feeds and the rest) now end with a slash, as most hosts serve the folders builds write, and so do links between pages, so following one needs no redirect; a site whose host serves them without one sets `trailingSlash: false` in its config, or Next.js's own. The docs say how to host a site anywhere, such as on AWS, Google Cloud or DigitalOcean, and the Domain screen explains connecting a domain on any host.
- dfd7ea3: Synced blocks: blocks kept once in `content/synced-blocks/` and shown wherever the new Synced block block places them, on pages, collections' designs and the header and footer, so changing one changes every page. The admin panel lists, makes, renames and deletes them, edits each in an editor of its own (with a version for each language), saves a block on a page as one and detaches one into a page's own blocks. The site checks catch synced blocks that aren't there, links inside them are checked and moved with pages, the Claude connector reads and writes them, and WordPress's synced patterns import and export as synced blocks.
- 1023c64: Count visits with Plausible, Umami or GoatCounter: Site Settings' new Visit counts screen reads the service's code, adds its script to every page (waiting for visitors to allow statistics on a site that asks them first, unless the owner says it needn't), and links to the service's dashboard.

### Patch Changes

- d0a47cb: Packages' npm descriptions, and the Claude Desktop extension's name, say Goodfellow CMS, the official name, so they're easier to find.
- cf403e0: Plugins' tasks run in two parts, so the site's code never runs where their secrets are. Loading a site's config runs every package it imports, plugins' own included, and on Linux a process can read the environment its parent started with, so a package could read every secret of the job that ran a task. Now `goodfellow task --describe` (and `goodfellow-next task --describe`) loads the config in a job with no secrets and writes the task down, and the job with them installs Goodfellow's task runner from npm apart from the site's packages, installs those without running their scripts, and runs the new `goodfellow-task` bin of `@goodfellow-cms/core`, which never loads the config and checks what was written down: the task must be the plugin's own module, ask for none of the hosts' own variables, and for a plugin installed from the Plugins screen ask for no more than its owner approved.
  
  The starters' `plugin-task.yml`, `.gitlab-ci.yml` and the Bitbucket and Cloudflare setups `planSite()` writes are the new ones. On GitLab, scope plugins' variables to the `goodfellow-tasks` environment so only the task's job has them; Bitbucket gives every step every repository variable. Sites made before this run tasks in one job until a developer copies the starter's task setup, since updates can't change a site's workflows.
  
  The lockfile jobs' early-update check now refuses a `package.json` that names `@goodfellow-cms/core` as anything but a release from npm, such as a URL or a git repository, which `npm exec` would otherwise install and run.
- 19d7812: Front matter ends only at a line of its own `---`; moving a page re-points redirects to it however they write its address; languages with capitals, such as pt-BR, can have their own item addresses; structured data gives a time clocks skip as the instant it is; an event can't stop repeating before it starts, and a daily event from long ago shows its next day; `goodfellow due` reads a copy's own build record and, the first time, looks back to when the live site was built; `goodfellow-next finish` reads what `next build` wrote wherever the config's `distDir` puts it; scheduled builds are kept in step with the live site only, never a draft, and stale ones are removed once the admin panel loads; and the Updates screen waits for the run it started before showing how it went.
- 19d7812: Translations keep the schedule of the page or item they copy; each language's feeds name their own address; a calendar list no longer reports a day already past for an event that runs past its end; impossible dates such as February 30 are refused; rich text with only a picture, video, line or table isn't empty; a turned phone photo's width and height are read the way it's shown; uploads always lose a JPEG's Exif, and PNGs' and WebPs' details too; redirects can't take `/sitemap.xml` or `/robots.txt`, and a redirect that differs from a page or another redirect only in capitals isn't written; the site checks read redirects' old addresses as visitors' links reach them; and the media library finds files used in menus, other languages' headers and footers, code and redirects, never counting a file whose name only starts the same.
- 19d7812: Full-stack sites' servers check what they're sent as the admin panel does: media must be a kind the site can use by the name it's saved under, and SVGs already cleaned; pages sent as bytes are read as text; a block an owner set to be used exactly as written is the owner's whole, and two blocks with one id are refused; editors may add and remove media storage's files but not move it; and settings submitted for review are owners' too. SVG cleaning keeps out more ways of spelling another site's address (`/\host`, `URL(`, CSS escapes in any attribute, `image-set()`), and media SVGs are sandboxed however their extension is spelled. The Next.js starter has a `vercel.json` that turns off previews of drafts' and tasks' branches, which updates add to older Next.js sites.
- Updated dependencies [0177574]
- Updated dependencies [0177574]
- Updated dependencies [d345032]
- Updated dependencies [e7dd766]
- Updated dependencies [19d7812]
- Updated dependencies [58556ef]
- Updated dependencies [b4f074a]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [bff0a8a]
- Updated dependencies [d0a47cb]
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
  - @goodfellow-cms/ai@0.9.0
  - @goodfellow-cms/core@0.9.0
  - @goodfellow-cms/react@0.9.0
  - @goodfellow-cms/registry@0.9.0

## 0.8.0

### Minor Changes

- 911f778: The admin panel speaks Spanish as well as English. Each editor gets the language their browser asks for first, or chooses one with the new language menu beside their account, which their browser remembers. Everything follows it:
  - the admin panel's own text;
  - Puck's controls in the editor, through its `dictionary`;
  - the names, groups, settings, choices and placeholders of the built-in blocks and the page settings.
  
  A site's own blocks are translated wherever their labels are worded like the built-in ones. The Spanish text loads only when someone chooses it. The language is each editor's, separate from the site's languages, and the `strings` an `Admin` is given still apply on top of it.
- d21884a: On sites kept on GitHub, Site Settings has a Comments screen that sets up comments: it makes a public repository of their own beside the site's, with Discussions turned on, or connects one you already have, and publishes where they're kept as `content/site.json`'s `comments`, which the Comments block now shows without Giscus's code. The same screen lists visitors' comments page by page, and hides, shows and deletes them and closes pages to new ones. Where the sign-in can't reach that repository, as with the sign-in service, it asks for a GitHub token of the owner's own, kept only in the tab. GitHub backends offer this as `comments` (`SiteComments`), and the token broker asks before making the repository or deleting a comment.
- 293bbf0: Visitors' consent asks about kinds of content: other sites' content, and statistics and advertising where Site Settings → Code says the site's code is for them. Visitors can allow each kind on its own from the notice's Choose, and code marked as needed for the site to work loads without asking. A visitor's answer now lasts as many days as Site Settings says (180 by default, at most 395), and the notice asks again once it's older, or when the site asks about a kind it didn't before. Answers kept by earlier releases are asked again once.
- 141a23d: Every block's Style settings can hide it on phones (narrower than 640px), tablets (640px to 1023px) or computers (1024px and wider), so a page can show something different on each without writing Tailwind classes. The choice is kept as Tailwind's breakpoint classes (`max-sm:hidden`, `sm:max-lg:hidden`, `lg:hidden`), which `readBlockStyle()` reads as `hiddenOn` and `withBlockStyle()` writes, and apps hide the block on the same sizes of screen, since they now read `max-` breakpoint classes too. The documentation site's header uses it to put the menu button and dark mode switch at the top right on phones and tablets, with the search on a line of its own on phones.
  
  Builds' accessibility checks look at pages that hide blocks on some screens as each size of screen shows them, so a menu for phones and one for computers aren't reported as two parts of the page with the same name.
  
  `SiteImage` gives images the build knows the size of their `width` and `height` even where it doesn't list smaller copies, such as SVG logos in `goodfellow build`, so browsers keep their space before they load, as Next.js's `next/image` already did.
- ecfbab6: Three built-in blocks: a Document viewer that shows a PDF from the media library on the page, a Donate button to a giving page such as a Stripe payment link, and Share buttons that link to share the page on social sites or by email. Donate and Share are links only, so pages load nothing from those services. WordPress imports bring PDFs WordPress shows on the page across as Document viewers, and exports write the Document viewer and Donate button as WordPress's own blocks.
- 676ab5c: Menus work on phones. The Menu block's **Show the links behind a menu button (☰)** shows every link, every level of them, under a button on phones, on phones and small tablets, on phones and tablets, always or never, with no JavaScript; the editor says when a menu's submenus can't be reached on phones because it never shows the button. The starters' and the example's headers show it on phones and small tablets. In Next.js sites, the menu button's links close after moving to another page.
  
  The admin panel works in narrow windows: its links, View site and the account are under a menu button there, and a Dark mode switch takes the place of the list of colors.
- 8622adc: A Newsletter signup block: an email box that signs visitors up through Mailchimp, Buttondown, Kit, any other service whose signup form is HTML, or the site's form service, as a plain form that loads nothing from the service until someone signs up.
- 51a992a: A Social post block shows posts from Bluesky, Mastodon, Instagram and X, and Spotify's and SoundCloud's players, from the post's address or its site's embed code, sandboxed and held back until visitors agree where the site asks. WordPress imports bring such embeds across as Social posts, and exports write them as WordPress's own embeds.
- 5e9a95b: Sites can ask visitors before showing content from other sites. With **Site Settings → General → Visitors' consent** on, a notice at the bottom of each page asks, and until visitors agree, YouTube, Vimeo and other sites' players, Google forms and maps load nothing and show a note with a button in their place, hCaptcha waits, and the site's custom code (all of the end of the page's, and the head's scripts, links and `noscript`) waits too. The answer is kept in the visitor's browser, links to `#consent` open the notice again, and every word of it can be changed, in each of the site's languages.

### Patch Changes

- f3e81fb: After publishing stops because someone else changed the same page, **Reload** now shows their version in the editor, so publishing again can't put the old one back over theirs. **Put my changes back** brings back what you'd made, to publish it over theirs on purpose.
- 2e22322: Fixes to asking visitors before loading other sites' content:
  
  - The head's links to the site's own files, such as a stylesheet or icons, stay on the page; only links to other sites wait for visitors to agree (`isHeldHeadElement(element, siteUrl)`).
  - Code that has `</template>` in it, which would run before visitors agree, is left out of pages while the site asks. Site Settings won't publish it, and Custom HTML used as written is made safe instead (`endsHeldTemplate()`).
  - The consent script finds the notice by `data-gf-consent-notice`, so an element in rich text with the same id can't hide it. The notice is named by its message for screen readers, and a link to `#consent` moves the keyboard's focus to it.
  - The notice's words come in the site's main language where there are default words for it (English and Spanish), and each language's pages get their own default words (`consentDefaults()`, `consentInLanguage()`). Turning asking off and on again keeps the words that were written.
  - Google forms and maps keep their Style on the box around them, in the editor and on the site alike (`ConsentFrame`'s `boxClassName`).
  - The docs say that full-stack Next.js sites load fonts from Google before visitors agree.
- 368f04e: On full-stack Next.js sites, only owners can choose to use Custom HTML exactly as written, which runs it on the site. Editors see the setting but can't change it, and the site's server refuses a publish that changes it or adds the block with it. Blocks of a site's own can mark settings like that with `metadata: { owners: true }` (`ownersOnlyFields()` and `ownersOnlyChanges()` in `@goodfellow-cms/core`, `AppApiOptions.ownersOnly`).
- 65239e6: Editor plugins' frames show the site's media as the standard editor does: from the site's folder on a site in a folder of its domain, from memory for a picture just uploaded that the site doesn't have yet, and from the storage a plugin keeps the site's media in, whose address their frames may now load images and videos from. Text edited in place keeps content's `/media/` addresses. Plugins can tell from `session.showsMedia` and leave the addresses as they are.
- 5113b06: The admin panel checks what Puck's editor hands back before publishing it (`checkPuckData()`), as it does editor plugins': only plain data, and only the site's blocks. Uploaded SVGs keep what they load as they draw to the file itself and the site, so opening one tells no other site. Media addresses are checked once decoded, so `%2e%2e` can't name another folder and a stray `%` no longer stops the admin panel. Blocks are installed from the registry release the admin panel came with, even where a build bundles its source, never the newest one.
- e558acd: Links that would run code, such as `javascript:` or `data:` addresses in menus, buttons or items' link fields, are left out of built pages, and the site checks stop a publish that adds one. A file replaced in the media library must be the same kind as the one it replaces, and every file published into the media library, a plugin's included, is checked by the name it's saved under, with SVGs cleaned again.
- 4744a5f: Full-stack Next.js sites submit owners' changes to the site's code, such as adding blocks on the Blocks screen, for review by default, since their server runs that code with its token and keys; `goodfellowApi({ codeChanges: "publish" })` lets owners publish them. The sign-in service says the app isn't installed as soon as it's uninstalled, rather than that signing in isn't working. New sites' setup asks whether you have a domain, starts with an admin address where you do and the host can serve one, and otherwise recommends a sign-in page of its own; the Security and Code tabs say when editors' sign-in is within reach of the site's pages.
- 9731fc0: Uploaded SVGs keep only SVG's own drawing elements and safe attributes, so scripts written with another prefix, links to scripts spelled with entities and animations that set links are removed. A plugin's server requests stay under its own address, however `..` is spelled. The token broker asks about a new Site address however the site's settings are written, and when they're deleted.
- Updated dependencies [a341e5f]
- Updated dependencies [8d9d46c]
- Updated dependencies [d21884a]
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
- Updated dependencies [8622adc]
- Updated dependencies [90e3369]
- Updated dependencies [7a9a116]
- Updated dependencies [6b674a8]
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
  - @goodfellow-cms/registry@0.8.0
  - @goodfellow-cms/react@0.8.0
  - @goodfellow-cms/ai@0.8.0

## 0.7.0

### Minor Changes

- c6afe19: Every block in the editor's block list has its own icon, in place of the drag handle every block shared, and so do the blocks the search finds. Blocks get one with `withIcon()`, from Lucide-style icon data, which the site's description carries for editor plugins; the built-in blocks have Lucide's, and blocks without one show a box. Switching between the standard editor and an editor plugin now takes the latest changes along, and asks first when the other editor can't keep some of them.
- a8e3581: The editor's block list has a search box, which finds blocks by their names, their groups and other words for them, such as "divider", "columns" or WordPress's "Cover", and blocks found are dragged onto the page as from the list. Blocks declare those words with `withKeywords()`, which the site's description carries. The groups that fit what's edited start open, such as Navigation in the header and footer, and the built-in Content group is now two, Text and Buttons and forms.
- 48366cf: Every block's look can be set without code: its CSS classes setting is now **Style**, which the editor shows as controls for text alignment, text size, text and background colors (the theme's, or your own), space inside and around it, each side or all at once, and rounded corners, with a note when text may be hard to read on its background. They're kept as Tailwind classes in the block's `className` (`readBlockStyle()` and `withBlockStyle()` in `@goodfellow-cms/core`), beside any other classes, which **Other CSS classes** keeps, so content files, themes' parts, the Gutenberg plugin and the AI assistant work with them as before. Blocks with an alignment setting of their own keep it.
- cedcb3a: Editor plugins' frames are the editor's alone: they keep the admin panel's colors and font but no longer get a screen's spacing or plain element styles, which reached the site's blocks drawn in them. Their policy lets them load the theme's Google Fonts, as the standard editor's frames do, and `session.styles()` gives the fonts' stylesheet as `fonts`.
- 42cf54b: Owners can limit what each editor changes, on the Editors screen's Limits section: page sections with their translations, collections' items, the media library, the header and footer, the menus, and languages, kept in `content/permissions.json`. Everything else is read-only to them, and publishing changes outside their limits offers Submit for review, which asks the site's reviewers (every owner, unless the file names some) on GitHub, GitLab and Bitbucket. Owners see drafts waiting for their review in the draft bar, and publishing or throwing away a draft closes its review. The token broker and the Claude connector keep to the same limits, and full-stack sites' servers refuse writes outside them. The sign-in service's everyday app now asks for Pull requests, which submitting for review needs.
- a52b217: Staging copies of a site: a build with `GOODFELLOW_SITE_URL` uses that address in place of the Site address, and `GOODFELLOW_NO_INDEX=true` keeps every page out of search engines, without either one reaching content. The config's `copies` lists them for the sign-in service, through `goodfellow-site.json`. A copy at an address of its own keeps its admin panel there, and the Domain screen says where it is.

### Patch Changes

- a50ae8f: An editor plugin's page editor shows a spinner, with "Opening …", until it has opened, rather than an empty space.
- 45a692b: A page's address can no longer end in `/index`. Such a page was stored in the file of the page above it, so making `/index` replaced the home page, and `/news/index` the page at `/news`. The admin panel now says the address can't be used, and the Claude connector, imports and items' addresses refuse it too.
- 45a692b: Site Settings no longer says there are unpublished changes when nothing was changed, on sites whose settings or redirects were written with values the form tidies when it saves, such as a switch stored as off or an empty contact detail.
- dd3da3e: Switching from an editor plugin back to Puck keeps what was edited where a block fills in its own choices, such as Collection list's choice of its collection's fields: the site's description says which blocks do (`resolvesFields`), and values left as the editor opened them are kept. Anything that still can't be kept is named by its block and setting, not its place in the page's data.
- Updated dependencies [c6afe19]
- Updated dependencies [a8e3581]
- Updated dependencies [48366cf]
- Updated dependencies [8f7fa14]
- Updated dependencies [4f79454]
- Updated dependencies [3bb8c96]
- Updated dependencies [cedcb3a]
- Updated dependencies [42cf54b]
- Updated dependencies [45a692b]
- Updated dependencies [45a692b]
- Updated dependencies [ede249f]
- Updated dependencies [db58e5d]
- Updated dependencies [a52b217]
- Updated dependencies [dd3da3e]
- Updated dependencies [6701c92]
  - @goodfellow-cms/react@0.7.0
  - @goodfellow-cms/core@0.7.0
  - @goodfellow-cms/ai@0.7.0
  - @goodfellow-cms/registry@0.7.0

## 0.6.0

### Minor Changes

- 1b9781e: Sites stored on Bitbucket Cloud, with `@goodfellow-cms/bitbucket`: sign-in with a repository access token, an Atlassian API token or Bitbucket's own sign-in, publishing as one commit that fails when someone else has published since, version history, drafts and pull requests, editors from the workspace, failed rebuilds explained, the nightly update, scheduled changes that go live at their time (each with a one-off Pipelines schedule) and plugins' tasks through Bitbucket Pipelines, and content in a repository of its own, with Vercel putting the site online. `create-goodfellow --bitbucket` creates such sites, with `--content` too, `goodfellow due` and `goodfellow-next due` take `--output`, and the token broker, the Claude extension, the Claude connector service and the admin panel know Bitbucket too.
- 3436a92: Editor plugins can have blocks drawn by the site's own code: `session.draw(block)` gives one block's HTML as the site draws it, in the page edited, with each of its slots left as an empty `<gf-slot data-slot="…">` (`DRAWN_SLOT_ELEMENT`) for the editor to put the slot's blocks in, and `session.styles()` gives the site's stylesheets with the theme's colors and fonts, and Tailwind's source, so an editor without the blocks' code can show them as they look on the site.
- 2f6c59e: Plugins can offer a page editor of their own (`editor` in a plugin, its admin module's `editor.mount()`), which each person editing the site can choose in place of the standard editor from the editor's header, for pages and, where the plugin says so, the header, footer and collections' templates. It runs in the plugin's sandboxed frame, is given what's edited, the blocks' fields, the site's settings and pages, the media library and the link preview, and hands back what's edited; the admin panel keeps Publish, drafts, the AI assistant, and Undo and Redo, and publishes only what passes `checkEditedData()` against the site's blocks. The Plugins screen and the token broker say when a plugin offers an editor, and installed plugins need approving again to add one.
- f591bc0: Plugins can keep a site's media in a storage service in place of `public/media/`, as S3 storage (`goodfellow-plugin-s3`, in a repository of its own) does. A plugin with `mediaStorage` takes the Media screen's uploads, larger ones too, and `content/media-storage.json` lists the files it keeps by their `/media/` addresses, which builds, `goodfellow dev` and Next.js show from the storage's public address, so pages don't change. The Media screen moves the site's own files there and back.
  
  Plugins can also run tasks in the site's CI, with secrets the admin panel never holds: an admin module calls `api.task(id, input)`, and the starters' new `.github/workflows/plugin-task.yml`, or the `plugin-task` job in `.gitlab-ci.yml`, runs `goodfellow task` (`goodfellow-next task`) with only the secrets the plugin declared, sealing the answer to a key only that admin panel holds. It takes about a minute. `goodfellow dev` and `next dev` run tasks on the computer, and full-stack sites pass them through their server. Sites made earlier copy the starter's `plugin-task.yml`, or the `plugin-task` job and the `pages` job's new rule, to run tasks.
  
  Plugins' screens fill the screen as the admin panel's own do, drawing their own heading in a frame as tall as what they draw. `api.secretsHelp()` tells a plugin how the site's owner adds its secrets for this site, in steps for GitHub, GitLab, the development servers' `.env.local` or a full-stack site's server, and a site's config can give a plugin `options`.
- 6bf08ae: Every part of a block has a stable name, such as `gf-heading` or `gf-card-title`, and **Colors & fonts → Blocks' parts** gives a part classes for every block of that kind at once, kept in `content/site.json`'s `theme.parts`. A part's classes come after the block's own and before what's chosen for each block, so a choice made for one block still wins. Blocks name their parts with `useParts()` and declare them with `withParts()`, from `@goodfellow-cms/react`; the registry's blocks name theirs after themselves, such as `gf-shadcn-cards-title`. Images and videos with **Rounded corners** off now have the `rounded-none` class, and Rows that don't wrap `flex-nowrap`, so a theme's classes can't change them.
- b803050: Plugins' frames come with the notices of what they bundle: `goodfellow build`, `goodfellow dev`, `goodfellow-next finish` and `next dev` write `admin/plugins/<id>/LICENSES.txt` beside each frame, listing every package it bundles with its version, license and where its source is, then each license text once, and the frame's page links to it. Editor plugins' `session.styles()` gives `{ stylesheets, tailwind }`, with Tailwind's source for classes the site's last build hasn't seen, and `htmlBlocks()` in `@goodfellow-cms/core/wordpress` turns pasted HTML into the site's blocks with the WordPress import's conversion.
- 4c909ac: Install plugins from the admin panel. Site Settings → Plugins finds `goodfellow-plugin` packages on npm, offers releases at least three days old that say they work with the site's Goodfellow release, and shows what each asks to do (its `goodfellow-plugin.json`) and what its packages' code could do: network requests, other programs, code made from text, native code and install scripts. Installing adds the package to `package.json` at an exact release and records what was approved in `plugins/installed/`, whose `index.ts` sites' configs import as `installedPlugins`; a plugin asking for more than that stops the site from loading. It's offered at a checked admin address or with a token broker, whose own dialog names the plugin and what it asks to do; full-stack sites submit it for review. The starters' workflows, and Cloudflare Pages' generated ones, write `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, running none of the new code, and build the site with it. The Updates screen warns about releases outside an installed plugin's range, and `create-goodfellow --plugin` installs plugins in new sites. Sites made earlier need the starter's `deploy.yml` or `.gitlab-ci.yml` before the Plugins screen installs anything.
- 11a429f: Plugins, which developers add in the site's config (`plugins`), add what blocks can't: an admin module run in a sandboxed frame of its own whose Content Security Policy reaches only the addresses it declares, screens in Site Settings that read and publish only the files it declares, build steps each run in a Node process of its own with Node's permission model and only the secrets it declares, and routes on full-stack Next.js sites' servers, as well as blocks of their own. Blocks in the editor ask a plugin's services with `useSite().callPlugin`. See the docs' Plugins page.
- be7bbec: Install themes from npm. Site Settings has a Themes screen that finds packages named `goodfellow-theme-<name>`, previews one on the site, and installs it: its colors, fonts and parts' classes go into the site's settings, its CSS goes at the start of the custom CSS, and its header and footer replace the site's if the owner chooses. A record in `content/styles/theme.json` lets updates replace only what nobody has changed since. A release is offered once it's three days old and only if its `peerDependencies` range on `@goodfellow-cms/core` includes the site's release. The Updates screen says when a newer Goodfellow release is outside the installed theme's range.
- b9b0434: Built-in blocks for WordPress's core blocks Goodfellow had nothing like: Separator, Pullquote, Preformatted text, Verse, Details, Table (edited in a grid of cells, which the AI assistant can fill in too), File, Audio, Media and text, Gallery and Page list. Sections get a cover's color over the background, its strength, a least height and the part of the picture to keep in view, and Site name and logo can show the site's description under the name. Moving from WordPress keeps these blocks as they are, falling back to the blocks used before on sites without them, and exporting to WordPress makes them WordPress's own again. Media fields can hold sound files (`mediaField(label, "audio")`), blocks can read the site's pages with `useSite().pages`, and `tableField()` gives a block a table's cells.

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
  - @goodfellow-cms/react@0.6.0
  - @goodfellow-cms/registry@0.6.0
  - @goodfellow-cms/ai@0.6.0

## 0.5.0

### Minor Changes

- 043358b: Add a token broker from the admin panel: Site Settings' Security tab makes the broker's repository from Goodfellow's released page, with a token that can create repositories, and puts it online with GitHub Pages (at a domain of its own) or GitLab Pages (at the project's unique domain), or leaves it ready for Cloudflare Pages or Vercel. `goodfellow broker add`, `use` and `remove` do the same from a computer. `create-goodfellow` (`--admin`, `--broker`, `--broker-domain`) and the setup page offer an admin address or a sign-in page of its own for new sites. The docs have a new Security page.
- 938e468: An address of its own for the admin panel, such as `admin.example.org`, so the site's pages can't reach what it keeps. Site Settings' Domain screen sets it on GitLab Pages, Cloudflare Pages and Vercel, writing the config's new `admin` line: `goodfellow build` and `goodfellow-next finish` then start every page with a script that sends it to the Site address when it's opened at the admin address, fail if a page can't start with it, and write Cloudflare Pages' header rules, while the starters' `vercel.ts` and `withGoodfellow()` give Vercel's. Once the admin panel has checked the address from there, it opens only there and refuses to be shown in a frame. The sign-in worker gives tokens to the admin address too. The Blocks screen offers blocks from the config's `registries`, and shadcn/ui's own, only at a checked admin address and in `goodfellow dev` and `next dev`. GitLab's backend can publish files outside the editable folders, such as the config.
- e819602: Cloudflare Pages as a host. `create-goodfellow --host cloudflare-pages` and the setup page give a site a nightly update and rebuild, and the checks for scheduled changes, on GitHub Actions or GitLab CI, which ask Cloudflare to rebuild through the project's deploy hook (`CLOUDFLARE_DEPLOY_HOOK`). The admin panel shows when Cloudflare has built the site, from its check runs and commit statuses, and GitHub token links ask for Commit statuses. `goodfellow build` and `goodfellow-next finish` write `_redirects`, so Cloudflare sends the site's redirects itself. The Domain screen explains connecting a domain in Cloudflare, and the media library notes Cloudflare's terms for videos.
- ba80f97: Sites whose content is kept in a repository of their own can have an admin address. The Domain screen connects it and shows what a developer runs: `goodfellow admin add` names it in the code's `goodfellow.config.tsx`, and `goodfellow admin check` checks it from a computer, as the Domain screen does from the address, then marks it checked (`goodfellow-next admin` for Next.js sites, which also get `goodfellow-next broker use` and `remove`). Where Vercel builds the site from the content repository, the address's header rules are written into its `vercel.ts`. `create-goodfellow --admin` and the setup page offer an admin address with a content repository too.
- e62801d: Drafts in the admin panel. The editors' **Add to draft**, beside **Publish**, keeps a change on a draft branch instead of publishing it, and while a draft is open every Publish adds to it. A bar on every screen shows the draft, with **Publish all**, which runs the site checks over everything in it and publishes it in one change with one rebuild, **Submit for review**, **Throw away** and **Back to the live site**. Drafts stay when the tab closes, other editors see them, and ones started from Claude can be finished there. Full-stack sites, demos and the development servers keep the draft in the browser instead (`keptDrafts()`). Drafts can be listed (`SiteDrafts.list()`), list the files they changed (`Draft.paths()`), and start at a given revision (`create(name, { from })`). The starters' `vercel.ts` turns off Vercel's previews of draft branches; existing sites on Vercel can add its `git: { deploymentEnabled: { "goodfellow-draft-*": false } }` line, and sites on Cloudflare Pages can set preview branches to None.
- 9b96dd3: The editor's sandbox. The admin panel's page, which signs in and publishes, no longer loads the site's config or any block's code: Puck, the config and every block run in frames sandboxed without `allow-same-origin`, which talk to the page through one message port, so blocks can't reach editors' tokens or AI keys. The page draws the editor's header, Undo and Redo, preview widths, Publish and the AI panel outside the frame; the Settings, Version history and Site history previews, the pages rendered to check a publish and the preview page for screenshots are frames too. The site's CSS is kept to the editor's canvas, with its width media queries as container queries, so the phone and tablet buttons show the site at those widths. The frames' Content Security Policy lets them fetch nothing and run only the site's own scripts, which first remove WebRTC.
  
  `Admin` takes `site` (`adminSite()` from `@goodfellow-cms/react`) and `frames` in place of `config`; `GitHost.source` lets the admin panel make the site's git host again. `goodfellow build` writes the frames' page at `admin/editor/`. Next.js sites get `app/admin/editor/page.tsx` (`GoodfellowEditor` from `@goodfellow-cms/next/editor`), their `app/admin/page.tsx` becomes a server component passing `site.admin()` to `GoodfellowAdmin`, and `goodfellow-next finish` writes the editor page's policy. An `app/admin/page.tsx` that still passes `config` loads every block's code itself, so the admin panel only says how to update it there and never signs in; `goodfellow-next update` replaces it with the starter's, and adds the editor page, wherever nobody has changed it, on its first run after this release. Every frame is sandboxed with `allow-scripts` alone, in `goodfellow dev` and `next dev` too: they bundle the frames as builds do, rebuild them as the site's code changes and reload the frames, leaving the admin panel's page as it is. `@goodfellow-cms/next` depends on Rolldown for that, loaded only in `next dev`.
- 1590ea2: Export a site to WordPress, as a WordPress export file that WordPress's importer reads: from Site Settings → WordPress, or with `goodfellow export wordpress` and `goodfellow-next export wordpress`. Pages keep their addresses and their blocks become WordPress's, items of collections with pages become posts with their categories and tags, and the menus and media library come too. The Import tab is now called WordPress.
- 78d29e5: Import a WordPress site's pages, posts, categories, tags, menus and media, from its export file or its address: in Site Settings → WordPress, with `goodfellow import wordpress` and `goodfellow-next import wordpress`, or when creating a site with `create-goodfellow --wordpress`. WordPress's blocks become Goodfellow's built-in blocks, posts become a collection of Markdown items, and old addresses send visitors on to the new ones.
- 11d4f6a: More for sites in several languages. Header & Footer picks a language and gives it a header or footer of its own. The page and item editors have a language menu that opens their translations, or makes one. The site checks suggest translating pages and items that have no translation or an out-of-date one, when a publish brings them, and builds list them. Events and stories say their language in their structured data. In Next.js, the header and footer stay in the shared layout, one for each language, and the browser shows the page's.
- 564d1dc: Sites rebuild overnight only when visitors would see something new. Every build writes `goodfellow-build.json` with what it was built from and when what it shows by today's date next changes, and the starters' setups run `goodfellow nightly` (or `goodfellow-next nightly`) first each night, building only when there are fixes to install, something dated has changed, or the live site isn't the newest build. On GitLab Pages, a night with nothing new publishes the live site's files again. The Updates screen lets owners choose to rebuild overnight only when something changed, every night or never, and has Rebuild now. On GitHub the choice is the `GOODFELLOW_NIGHTLY` repository variable, which the sign-in service's owners' app now asks for the Variables permission to set.
- 0b4972a: Site checks on rendered pages, finishing roadmap step 26. Publishing warns about images without a description, headings that skip a level and links whose text, such as "Click here", doesn't say where they go, on the pages it changes as they'll show. `goodfellow build`, and `goodfellow-next finish` for Next.js sites, check every built page for those and with axe-core's accessibility rules, explained in plain words, and say that automated checks find only some problems. Core's new `@goodfellow-cms/core/accessibility` entry has `checkBuiltPages()` and `reportSiteProblems()`, and `renderedProblems()` is in the main entry.
  
  Blocks' output is more accessible: the Image block has an "Only decoration" setting; logos beside the site's name and Collection list's pictures are marked as decoration; Collection list's item titles are level 2 headings when the list has no heading of its own, and Calendar's days are level 2; photo credits are no longer an `<aside>` inside the page's main content.
- 8ac5d0e: Restore the whole site as it was at an earlier publish, from Site Settings → Site history: every publish that changed the site's pages, items, settings or media, how the site looked after each, with its pictures, what has changed since, and restoring everything in `content/` and `public/media/` in one publish. Backends gain `filesAt(revision)`, which reads the site's files as they were, and `history()` lists a folder's publishes as well as a file's.
- 74bb2ad: Scheduled publishing: pages and collection items can be shown from a time and hidden after one (`showFrom` and `hideAfter` in their files, in the site's time zone), which builds, `goodfellow dev` and Next.js apply, leaving menus' links to them out until they're shown. The admin panel schedules pages from the Pages screen and items in their editor, lists what's coming up, and warns that scheduled content can be read early on a public repository. On GitLab it adds a pipeline schedule at each time, so changes go live then; the starters' new `.github/workflows/scheduled.yml` checks each hour with the new `goodfellow due` command and builds the site only when something has come due. Letting editors publish on GitLab now lets Developers merge too, which adding those schedules needs.
- 91b9a4c: Search engines and feeds: pages carry schema.org structured data (the site and its organization on the home page, events with their times and places, and dated items as articles), and collections whose items have pages and a date, such as news, get RSS and Atom feeds at `/feeds/<collection>.rss` and `.atom`, which every page links to. Both need the site's address. A page's settings can hide it from search engines, which also leaves it out of the sitemap, and the page editor shows how links to the page look when shared. `sendCalendarFile()` in `@goodfellow-cms/core/node` is now `sendBuildFile()`, which serves feeds too.
- 93fb9fa: Site Settings' tabs are in a sidebar on the left, each with an icon, with the tab's contents left-aligned beside it, so the screen no longer moves between tabs. **Hide names** shows only the icons, each with its name in a tooltip, and the admin panel remembers the choice; narrow windows show only the icons. Each tab's heading is now its own name.
- 884a0be: Sites in several languages. Add languages in Site Settings → Languages, each with the site's name and description in it; its pages go under its code, such as `/es/about`. The Pages screen and collections' lists translate pages and items into each language, say when a translation is out of date, and the AI assistant can translate a page or item. Each language can have menus of its own, the new Language switch block links to the page in each language, and pages say their language, link to their translations with `hreflang`, and are listed with them in the sitemap. Search finds only pages in the page's own language, and lists, feeds and calendars show only that language's items.
- 31217e1: Site checks (roadmap step 26). Publishing in the admin panel now stops when it would leave links to pages, items or media that don't exist, including links a deletion would break, and lists suggestions editors can publish anyway: pages without a title or description, and theme colors text is hard to read on, which Site Settings → Colors & fonts also shows as colors are chosen. `goodfellow build` lists what the checks find, and `goodfellow build --strict` fails on errors. Core exports `checkSite()`, `publishProblems()`, `contrastProblems()`, `contrastRatio()` and `formatSiteProblem()`.
  
  Moving a page, renaming an item or changing a collection's address pattern now changes every link to them on the site in the same publish (blocks, rich text, Markdown, items' fields, menus and redirects), so moves never stop a publish, and the move dialog no longer asks about menu links. `movePageChanges()` and `moveEntryChanges()` take the site's content (and its blocks, which say where links are) in place of its menus, `relinkSite()` and `relinkedChanges()` do the same for any change of addresses, and `updateMenuLinks()` is gone.
  
  The default muted text color is a little darker (`#6b6b6b`), so it's easy enough to read on the subtle background color.
- f9a405e: The token broker: a sign-in page on an address of its own, released as `@goodfellow-cms/broker`, which keeps editors' GitHub or GitLab sign-in and AI keys, shows the admin panel in a frame and makes every call to the git host and AI services for it, so nothing on the site's address can read them. It asks the editor in its own part of the page before publishing the site's code, custom code or a new Site address, installing a release or giving someone access, never changes workflows, and asks for owner tokens itself. The config's new `broker` line, which Site Settings' Security tab sets, makes the admin panel open only inside the broker, which the sign-in worker then gives tokens to alone. With a broker, the Blocks screen offers the config's other registries too. The admin address's guard and header rules let the broker frame the admin panel.

### Patch Changes

- 38dcc3a: The Pages screen's **Duplicate** makes a new page from a copy of an existing one's blocks and settings, with a title and address of its own, beside the page it copies. `duplicatePageData()` makes the copy.
- 93c5b2c: Goodfellow needs Node.js 22.23.4, 24.22.1 or 26.12.1 or later. Earlier versions decompress Brotli unsafely (CVE-2026-111497, "Node2Shell"). Builds read other sites, such as Calendar blocks' feeds, so a feed's server could run code on the computer building the site. New sites' GitHub workflows (`deploy.yml`, `scheduled.yml`) set up Node with `check-latest: true`, so they always get the newest Node 22 instead of an older copy on GitHub's runner. To do the same on an existing site, add `check-latest: true` under `node-version: 22` in each `actions/setup-node` step of its `.github/workflows/` files. GitLab's `node:22` image already has the fix. On Cloudflare Pages and Vercel, check the Node.js version in the project's build settings.
- fd00d26: A page's **Search engines** setting shows **Show in search results** where the page hasn't chosen, as that's what it does, without writing the choice into the page's file. **Page not found**, which is never in search results, shows **Hide from search results**, and the setting can't be changed there. `neverIndexed()` says which pages search engines are never told about.
- Updated dependencies [043358b]
- Updated dependencies [938e468]
- Updated dependencies [e819602]
- Updated dependencies [ba80f97]
- Updated dependencies [d74cf94]
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
- Updated dependencies [884a0be]
- Updated dependencies [31217e1]
- Updated dependencies [f9a405e]
- Updated dependencies [e1e236d]
  - @goodfellow-cms/core@0.5.0
  - @goodfellow-cms/react@0.5.0
  - @goodfellow-cms/registry@0.5.0
  - @goodfellow-cms/ai@0.5.0

## 0.4.0

### Minor Changes

- 6328aff: Finishing content in a repository of its own (roadmap step 25).
  
  - The setup page offers it under "Where to keep the content". It creates the code's repository and the content's, and connects them: on GitHub, private repositories get read-only deploy keys, with their private halves as Actions secrets of the repository that reads them; on GitLab, each project joins the other's job token allowlist, and the code project's job token may publish updates, with a nightly pipeline schedule. `SetupAccount.createSite()` takes `more` and `link` for this, and `separateSetupLinks()` says what connects a site's repositories.
  - `github({ repo, contentOnly: true, code })` and `gitlab({ project, contentOnly: true, code })` name the code repository, which new sites' configs now do, and the Updates screen follows its update job: the site's release, running updates and the last run, for people who can see it (`SiteUpdates.code`, and `no-access` where they can't). Going back to an older release from the Updates screen also skips the release it left. On GitHub, the sign-in service gives a second token for the code repository, which can only read it and its workflow runs, or for owners, run them.
  - The GitHub setup page's token links ask for Secrets as well, for the deploy keys.
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

- e8cd390: Goodfellow doesn't run a hosted sign-in service yet, so `github()` and `githubSetup()` no longer default to one: without `signIn`, editors sign in with a token, as they always could. Sites that run their own sign-in service name its address in `github({ signIn })`, as before. `GOODFELLOW_SIGN_IN` is removed.
- Updated dependencies [6328aff]
- Updated dependencies [72607c8]
- Updated dependencies [4caf245]
  - @goodfellow-cms/core@0.4.0
  - @goodfellow-cms/ai@0.4.0
  - @goodfellow-cms/react@0.4.0
  - @goodfellow-cms/registry@0.4.0

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
- 2264969: Sign in with GitHub, through Goodfellow's sign-in service. Editors get a token for the site's repository only, lasting an hour and renewed while they're signed in, and what they publish names them as its author. The service stores nothing about anyone's sign-in: editors' own GitHub tokens are revoked as soon as they've signed in. The first time someone signs in, the sign-in screen offers to install Goodfellow on the site, and GitHub's install page signs them in too. It works at the address in the site's settings, never on this computer; elsewhere, and when the service's daily limit is reached, editors sign in with a token as before. Owners sign in with a second app, for one tab, on the Editors, Domain and Updates screens, and the setup page signs in, and installs Goodfellow where it creates sites, through the service too. `github({ signIn })` names your own copy of the service, or `false` turns it off.
- 4d70cd8: The AI assistant can add openly licensed photos from Openverse where the media library has none that fit. Photos are saved to the media library with their credits in `content/media.json`, and pages list the credits of the photos they use. A checkbox in the AI panel turns it on or off, and `ai: { stockPhotos: false }` in the config turns it off for everyone.

### Patch Changes

- Updated dependencies [6532990]
- Updated dependencies [ace4b9c]
- Updated dependencies [7e618c6]
- Updated dependencies [2264969]
- Updated dependencies [4d70cd8]
  - @goodfellow-cms/core@0.3.0
  - @goodfellow-cms/react@0.3.0
  - @goodfellow-cms/ai@0.3.0
  - @goodfellow-cms/registry@0.3.0

## 0.2.0

### Minor Changes

- f776202: Plain-language explanations of failed rebuilds: the top bar's **What went wrong?** says whether the host didn't start the build, packages couldn't be installed, Pages isn't set up, a content file has a problem (linking to its version history), or the site's code couldn't be built, with the host's details behind a toggle. `goodfellow build` prints what went wrong for the admin panel, and an annotation on GitHub Actions. The GitHub backend now reads the deploy workflow's run, so a build that fails before deploying is reported as failed rather than building; the sign-in token link asks for Actions: read. The owner token now lasts a day, the shortest GitHub allows, instead of a week.
- caa6d55: Calendars: collections get a "Date and time, for events" field (`event`), with all-day events, end times and repeats (daily, weekly on chosen days, monthly on a date or a weekday of the month, yearly, every so often, until a date, with dates to skip), in the site's new time zone setting. A collection whose settings name its event field (`calendar`) is a calendar: builds write it as `/calendars/<id>.ics` for visitors to subscribe to, and each event as its own file. The new Calendar block shows events coming up, or a month at a time with a page for each month, from a collection, another calendar's `.ics` address (read when the site is built) or both, with "Add to calendar" and "Subscribe" links; Add to calendar does the same on an event's page. Collection list and Entry field show events' next times. New collections can start as Events. `sitePages()` lists the pages builds write, month pages included, and `goodfellow-next finish` writes calendar files into Next.js exports. Repeats are expanded, and calendar files read and written, with [ical.js](https://github.com/kewisch/ical.js).
- c8a935e: Custom domains: **Site settings → Domain** connects a domain to a site on GitHub Pages or GitLab Pages, lists the records to add at the registrar, and checks until it works (the records, the host's HTTPS certificate, and the site at its new address), then sends everyone to the secure address. Backends' new optional `pages` capability does the host's part; `checkRecords()` and `domainZone()` in core check DNS. GitHub tokens need the Pages permission to connect a domain, and the screen links to one that has it. Where editors sign in by being sent to the host and back, the screen reminds owners to allow the admin panel's new address.
- 03dc28f: Editors: **Site settings → Editors** lists who edits the site, and lets owners invite people (by username, or on GitLab by email), make them editors or owners, and remove them. Backends gain an optional `editors` capability. On GitHub, changing editors and GitHub Pages settings needs an owner token, which the new `ownerAccess` keeps in memory for the tab only; it replaces the Pages token link (`PagesDomains.tokenLink` is removed). On GitLab, owners can let editors publish to the main branch.
- 4b44513: Site settings can open links to other sites in a new tab ("Open links to other sites in a new tab" under General), for menus, buttons, rich text and Markdown. Links in rich text now open in the same tab otherwise: Puck opened every one in a new tab, marked `nofollow`, including links to the site's own pages.
- b61d3f2: Forms: a Form block whose questions are set in the editor. It's a plain HTML form, with no JavaScript, that posts its answers to the form service chosen in Site settings (Web3Forms by default, Formspree, or any service that takes a plain form post), which emails them and sends visitors back to a thank-you page. Every form has a hidden honeypot field, and Web3Forms' hCaptcha can be turned on in Site settings. The block can also show a Google form from its embed code. `formTarget()`, `formRedirect()` and `googleFormUrl()` are in `@goodfellow-cms/core`, and `content/site.json` has a new optional `forms` setting.
- 30c5903: Redirects: the page at an old address now says where it's sending visitors, with a link named after the page, in words the Redirects tab can change, and replaces itself in the browser's history, so Back no longer needs pressing twice. On Vercel, Vercel sends the redirects itself: new sites have a `vercel.ts` in place of `vercel.json` that reads them, and Next.js sites get them from `withGoodfellow()`. Redirects from addresses that pages have are left out, so pages still win.
- 8ea3680: Redirects: Site Settings has a Redirects tab for sending visitors from old addresses to new ones, and changing a page's address adds a redirect from its old one. Builds write a page at each old address that sends visitors on at once, which works on every host, `goodfellow dev` and `next dev` follow them too, and `goodfellow-next finish` writes them into Next.js exports.
- a210b23: Showing collections. Collection list gets a heading with a link beside it, filters by a choice or tags field, Z to A and any-field ordering, later pages (`/news/page/2`) and a page for each choice of a field (`/news/topics/music`). The new Collection loop block repeats blocks designed in the editor once for each item, with its values in placeholders such as `{title}`. Collections get a Tags field type (`tags`), for any number of a list's choices. Blocks can add pages to the page they're on with `withPages()` from `@goodfellow-cms/core`, which the Calendar block's month pages now use: `sitePages()` takes the site's blocks, and `Page.view` and `useSite().view` replace `Page.month` and `useSite().month`. `repeatsForEntries()` from `@goodfellow-cms/react` makes a block repeat its blocks for each item.
- d09a681: Automatic updates: `goodfellow update` (and `goodfellow-next update`) updates a site to Goodfellow's newest fixes, or a release it's given, with the Puck version that release uses, and updates blocks from Goodfellow's registry, replacing only files nobody changed (`planUpdate()`). It publishes the update only once the site installs and builds with it, and otherwise puts everything back. The starters' GitHub Pages and GitLab Pages setups run it each night. **Site settings → Updates** shows the site's release, fixes and newer releases, and the last update, installs fixes now, lets owners install a newer release, and on GitLab turns on job token pushes and a nightly schedule. Owners can turn automatic fixes off and go back to the previous release, which updates then skip until it's allowed again; these settings live in a new content file, `content/updates.json`. Backends gain an optional `updates` capability; the GitHub owner token can now run workflows.
- 7785ef5: Version history: pages, the header and footer, and collections' items have a **Version history** screen in the admin panel, listing every published version with who published it and when, a preview of each, and **Restore this version**, which publishes it again. Backends gain `history()` and `readAt()`, implemented for GitHub and GitLab and their fakes.
- 8f9eff2: A Video block: a video from the media library (MP4 or WebM, with a picture before it plays and WebVTT captions), YouTube (from its ID or any of its addresses, in the privacy-enhanced player), Vimeo (with do not track), or another site's player (from its embed address or code, sandboxed, and only from another secure site). It needs no JavaScript on the page. `youtubeVideo()`, `vimeoVideo()`, `embedPlayerUrl()` and the player addresses' helpers are in `@goodfellow-cms/core`. Media fields can hold videos (`mediaField(label, "video")`), whose chooser offers only videos, and WebVTT files can be uploaded.

### Patch Changes

- 84cfc23: The admin panel's tab shows the site's icon, as its pages do, instead of the browser's default: the admin page names it before the admin panel loads, and the admin panel follows a new icon as soon as it's published, even before the live site has been rebuilt with it. Next.js sites show it in the sign-in screen too by using `site.adminMetadata()` in `app/admin/layout.tsx`, as the starter now does.
- 2c07c71: Hardening from code scanning: trimming slashes and other characters no longer uses patterns that slow down on long runs of them (core's new `trimChars()`), and nor do reading SVG sizes, typed domains, link targets and README notes; heading anchors and rich text as plain text take tags out by scanning the text. Search results show any `<` or `>` in an excerpt as text, apart from Pagefind's highlights. Link targets decode an address's entities once, as browsers do. SVG uploads also lose `vbscript:` links and `data:` links other than images. Islands' generated module escapes `<`, `>` and line separators in names and paths.
- 4000e48: The demo banner and the message after publishing in a demo now say that changes show only in the admin panel, and that the site itself doesn't change.
- 0e97dd2: When the admin panel on your computer can't reach the development server's API, for example because another server answers at that address, its error says so and where it looked, instead of "Cannot read properties of undefined". The admin panel calls the development API with a trailing slash, so a Next.js site's `trailingSlash` setting has nothing to redirect. Browsers keep those permanent redirects and later apply them to whatever runs on the same port, which broke `goodfellow dev`'s admin panel after a Next.js site had run there. The API also accepts its addresses without one.
- c97095c: The Form and Contact details blocks' notes in the editor link to Site Settings, scrolled to Forms or Contact details (`useSite().adminLink()`, which the editor supplies). The Form block also says when Web3Forms' free plan won't send visitors to a thank-you page on another site. "Get an access key from Web3Forms" opens Web3Forms' sign-up form, and the admin panel's menu says "Header & Footer" and "Site Settings".
- 699e0dd: Goodfellow's repository moved to the `goodfellow-cms` organization on GitHub. Package READMEs and repository links, and the admin panel's link to release notes, now point to https://github.com/goodfellow-cms/goodfellow-cms and the documentation at https://goodfellow-cms.github.io/goodfellow-cms/.
  
  The starters' READMEs link to the documentation instead of sections of Goodfellow's README, which is now shorter.
- b55c95c: Only the first block on a page with pages of its own links to them, calendars by the month included, and the editor and its previews now show a page as the site does, with a note on each block that would have pages but doesn't (`pageView()` in `@goodfellow-cms/core`). A calendar's month stays in the middle of its heading with or without links to the months around it. "Published." now shows just under the Publish button, and goes after a few seconds or as soon as anything changes.
- Updated dependencies [f776202]
- Updated dependencies [caa6d55]
- Updated dependencies [2c07c71]
- Updated dependencies [c8a935e]
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
  - @goodfellow-cms/core@0.2.0
  - @goodfellow-cms/react@0.2.0
  - @goodfellow-cms/ai@0.2.0
  - @goodfellow-cms/registry@0.2.0

## 0.1.0

### Minor Changes

- 1d4191f: The admin panel has a dark mode. It follows the computer's light or dark setting, or the choice in its top bar's color menu, which the browser remembers. Puck's own colors and the code editor follow it; site previews keep the site's colors.
- 1414af7: The AI assistant. A new **AI** tab in every editor writes with AI: it adds blocks to a page, changes the selected block, or fills in a collection item's fields, and its answer goes straight into the editor to check, change or undo. Editors choose the service and use their own key, kept only in their browser: Claude through the official SDK with structured outputs, OpenAI, Gemini, Groq, Mistral, OpenRouter, the keyless OVHcloud AI Endpoints, any OpenAI-compatible service, or any chat app by copy and paste. The new `@goodfellow-cms/ai` package builds the requests, checks answers against the site's blocks and fields, and talks to the services; `@goodfellow-cms/ai/testing` fakes them. Sites can limit the services with `ai: { providers }` or remove the assistant with `ai: false`.
- fd6f851: Blocks from block registries. The admin panel has a **Blocks** screen that adds blocks built with shadcn/ui to the editor, and removes them, with no developer: adding one publishes its code into the site's `blocks/installed/` and the shadcn components it uses into `components/ui/`, in one commit, and the editor offers it once the site has been rebuilt. Removing a block is refused while content uses it, and keeps files someone has changed.
  
  `@goodfellow-cms/registry` is Goodfellow's registry, with nine blocks: Hero, Cards, Call to action, Testimonials, Notice, Pricing table, FAQ, Tabs and Image carousel. Its README documents the format for registries of blocks built with other libraries, which a site offers once its config lists them in `registries`.
  
  `create-goodfellow` starts new sites with the recommended blocks, or with `--blocks built-in` the built-in blocks only. `@goodfellow-cms/core` plans installs and removals (`planInstall()`, `planRemove()`), and its stores and the GitLab backend read and write the folders installed blocks use. `goodfellow dev` and `next dev` serve the site's copy of the registry, and `goodfellow` resolves `@/` imports from the site's root, as shadcn code expects. `@goodfellow-cms/react`'s theme adds the colors shadcn components use, such as `card` and `destructive`.
- b4b80a6: The Blocks screen marks blocks to add and remove, and publishes them all in one save. `planBlockChanges()` plans several adds and removes together, each as if the ones before it had been published.
- 2e85621: Custom CSS and the site's code are edited in a code editor (CodeMirror, loaded when first shown) that indents, closes brackets, suggests CSS properties and values or HTML tags, and finds and replaces. Undo in Site settings no longer counts a change that leaves every value the same as a step.
- 5492e22: Collections and templates. A collection, such as videos or events, lives in `content/collections/<name>/`: a `_collection.json` with its fields, an address pattern such as `/videos/{slug}` and a Puck template, plus one file per item. `goodfellow build` and `goodfellow dev` give every item a page from its collection's template, where `{field}` placeholders and the new template-only Entry field block show the item's values. The new Collection list block shows a collection's items on any page, as a list or cards, newest first, upcoming only, and so on. The admin panel has a Collections screen for creating collections, editing their fields and page design, and adding, editing, renaming and deleting items. `@goodfellow-cms/core` adds `allPages()`, `findEntry()` and the collection schemas; `@goodfellow-cms/react` adds a `template` Puck config, `templateOnly()` and `applyEntry()`.
- 2af75b7: Site settings has a Code tab for code from services such as Google Analytics: "In the page head" (script, style, link, meta, base and noscript tags, read with `parseHeadCode()`) and "At the end of the page" (any HTML), saved as `content/code/head.html` and `content/code/body.html`. `goodfellow build` and Next.js add it to every page with `HeadCode` and `BodyCode`; it never runs in the admin panel.
- 88ac239: Demo mode. A site whose config sets `demo: true` opens its admin panel to anyone, with no sign-in and a banner saying it's a demo. Visitors can try everything editors can, but nothing is published: Publish saves their changes, uploads included, in their own browser (IndexedDB), where they stay until the visitor clicks Start over. The Blocks screen lists blocks without adding or removing them.
  
  The demo starts from a copy of the site's content that builds include at `/admin/demo-content.json`, so no git host is called and the repository can stay private. `goodfellow build` writes it, along with the admin panel, for demo sites; Next.js sites serve it with `demoContent` from `goodfellowPages()`, in a new `app/admin/demo-content.json/route.ts`. `@goodfellow-cms/core` adds `demoContent()`, `demoStore()` and the config's `demo` option.
- 652b180: Markdown collections, code highlighting, search and blocks for documentation sites.
  
  - **Markdown collections:** a collection can store its items as Markdown files (`markdown: { body }` in its settings), with the other fields as YAML front matter. The admin panel's collection settings turn it on and convert every item; the body is edited in the formatted editor or a Markdown tab, and Markdown the formatted editor can't show, such as a table, is edited as Markdown only. `@goodfellow-cms/core` adds `parseMarkdownEntry()`, `serializeMarkdownEntry()`, `markdownToHtml()`, `markdownParts()`, `markdownHeadings()` and `canFormatMarkdown()`; HTML in Markdown is shown as text, and only safe addresses are kept.
  - **Code block:** code highlighted with Shiki when the site is built, with a title and a copy button. Code in Markdown text is highlighted too.
  - **Search block:** searches the site in the visitor's browser with Pagefind. Builds index a site only when a page has a search block (`data-goodfellow-search`); `goodfellow build` does it, `goodfellow index` indexes any built site, and Next.js sites run `goodfellow-next index out` after `next build`. Pages mark their main content for indexing.
  - **Collection navigation**, **Previous and next** and **On this page** blocks, for documentation and other sites with ordered collections.
  - Formatted text styles tables, images and code.
- 1bfecf7: Publishing to GitHub and GitLab. New `@goodfellow-cms/github` and `@goodfellow-cms/gitlab` backends edit a site's repository straight from the browser: GitHub with an access token from a prefilled link, GitLab with one-click OAuth (PKCE) or a token. Set `backend` in `goodfellow.config.tsx` and `goodfellow build` includes the admin panel at `/admin/`, with a sign-in screen, an account menu and a live-site status that follows the deploy after each publish. `@goodfellow-cms/core` adds the `GitHost` and `GitBackend` interfaces, `writeChanges()` (which saves over other people's changes to other files but never the same ones), and `@goodfellow-cms/core/testing` with an in-memory repository for fakes. `goodfellow dev` gives each site its own Vite cache and keeps watching content when folders are replaced.
- 809001e: The admin panel, running against local files. `goodfellow dev` now serves it at `/admin`: edit pages, the header and footer in Puck, and site settings (general, colors and fonts, menus and custom CSS) with a live preview. Classes typed in the editor are styled immediately by Tailwind running in the browser. Saves are single writes that refuse to overwrite changes made since the editor loaded. `@goodfellow-cms/core` adds the `ContentStore` interface, `ConflictError`, `isEditablePath` and reserved page addresses (`/admin`).
- ece9ba5: The media library. A new **Media** screen uploads, replaces and deletes images and files in `public/media/`, saying where a file is used before deleting it. Image fields in blocks, page settings, collection items and site settings get a **Choose image** button that picks from the library or uploads a new file. Large photos are shrunk, JPEGs lose hidden details such as location, SVGs lose scripts, and only file types that can't run code are accepted. Previews show new uploads straight away, and add the site's base path to media addresses. `FileChange` can now carry `bytes`, and every store implements `readBytes()`, with both backends, their fakes and the development server supporting uploads. `@goodfellow-cms/react` adds `mediaField()`, used by the Image and Section blocks, and the AI assistant is told which images the site has.
- 56dbc36: Site settings has Undo and Redo, across every tab, with typing in a field undone as one step; Ctrl+Z and Ctrl+Shift+Z (⌘Z and ⇧⌘Z on a Mac) work outside text fields. Fonts are chosen from a searchable list of Google Fonts, each shown in its own typeface, with "Site default" for each visitor's standard font.
- 8c69eb5: Add `create-goodfellow`, which creates a new site from the starter or the parish example (`npm create goodfellow@latest my-site`), and can set up where the site is stored and hosted. Sites can now keep their contact details (address, phone and email) in Site settings, shown wherever the new Contact details block is placed. A collection's link fields can choose an uploaded file, such as a PDF.

### Patch Changes

- c7ab18e: The item editor leaves out Puck's Blocks and Outline buttons, starts with the AI assistant closed, and gives the fields sidebar a wider width of its own, remembered separately from other editors. The formatted text editor is as tall as the Markdown one.
- 4ca2dc1: Every package has a README, keywords and links to its documentation, repository and issues, for its page on npm. All the packages are released together with the same version.
- d91eea1: The packages are published under the `@goodfellow-cms` scope on npm, such as `@goodfellow-cms/core` and `@goodfellow-cms/react`, since `@goodfellow` was taken. `goodfellow` and `create-goodfellow` keep their names, and the block registry's name in `components.json` and refs such as `@goodfellow/shadcn-faq` stays `@goodfellow`.
- Updated dependencies [1414af7]
- Updated dependencies [fd6f851]
- Updated dependencies [b4b80a6]
- Updated dependencies [5492e22]
- Updated dependencies [2af75b7]
- Updated dependencies [0ed1018]
- Updated dependencies [ce5faee]
- Updated dependencies [88ac239]
- Updated dependencies [652b180]
- Updated dependencies [1bfecf7]
- Updated dependencies [405de70]
- Updated dependencies [809001e]
- Updated dependencies [ece9ba5]
- Updated dependencies [536f2a8]
- Updated dependencies [04fc203]
- Updated dependencies [de03c18]
- Updated dependencies [4ca2dc1]
- Updated dependencies [d91eea1]
- Updated dependencies [8c69eb5]
- Updated dependencies [cff2c58]
- Updated dependencies [3a4c60d]
  - @goodfellow-cms/ai@0.1.0
  - @goodfellow-cms/core@0.1.0
  - @goodfellow-cms/registry@0.1.0
  - @goodfellow-cms/react@0.1.0
