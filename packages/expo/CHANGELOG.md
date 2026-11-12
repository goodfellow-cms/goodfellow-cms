# @goodfellow-cms/expo

## 0.11.0

### Patch Changes

- b26b5ae: The content API's manifest lists a hash of each media library file (`media`), which both builds write, so apps download a picture replaced at the same address again. The field is optional, so apps that don't know it keep working.
- f4a0a43: Long text no longer slows down reading pages, themes, WordPress imports, feeds, or apps' themes: a comment, block comment, or `[caption]` that never ends, or a long run of slashes or hyphens, used to take time that grew with the square of its length. Comments, scripts, and styles that never end are now read as browsers read them, to the page's end. Other sites' news feeds whose tags never end no longer slow the Feed list block's builds either, and adding a sign-in option after one that ends in a `//` comment puts its comma before the comment. Early installs refuse package names and releases with characters npm's command line could read as more than a name.
- f6fcc1a: Goodfellow's documentation is now at https://goodfellowcms.com, and the links the packages give, in their READMEs, the admin panel's help links, and the Claude Desktop extension, go there. The old address, https://goodfellow-cms.github.io/goodfellow-cms/, sends people to the same page at the new one.
- 1008a42: Blocks' settings, the AI assistant's instructions, and these packages' messages and READMEs use the Oxford comma in lists ("pages, items, and media").
  
  The AI assistant's instructions also say plainly that it follows the request's own directions, such as "Translate the page", besides what the person asks, while the site's own text stays content, never instructions.
- bc2f3bd: Fix several bugs found in review:
  
  - A page title with `$` in it (`$5 lunches`) goes into the site's title template as written, not as a replacement pattern.
  - WordPress and Markdown imports give a page whose address ends in `index`, or is under `/admin`, an address a page can have (`/docs/index-page`), rather than stopping.
  - Apps keep their whole copy of the site, manifest included, when a download fails part way through updating it.
  - An item's values are escaped in rich text inside a block's lists and objects (such as Questions and answers'), as they are elsewhere.
  - The Calendar's Subscribe links on a page in another language subscribe to that language's calendar file, which builds now write for every language, empty until it has events.
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
- Updated dependencies [b26b5ae]
- Updated dependencies [f4a0a43]
- Updated dependencies [44a825d]
- Updated dependencies [810503b]
- Updated dependencies [c4ecba5]
- Updated dependencies [f6fcc1a]
- Updated dependencies [ec40324]
- Updated dependencies [c39766d]
- Updated dependencies [5f09d89]
- Updated dependencies [f287d1c]
- Updated dependencies [3184524]
- Updated dependencies [d7098cb]
- Updated dependencies [bc2f3bd]
- Updated dependencies [7698210]
- Updated dependencies [6210740]
- Updated dependencies [e3678d8]
- Updated dependencies [c7c70ef]
- Updated dependencies [0255dbc]
- Updated dependencies [749d66b]
- Updated dependencies [3bcdfa1]
- Updated dependencies [db80e2f]
  - @goodfellow-cms/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [5c28336]
  - @goodfellow-cms/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [cfa0a83]
- Updated dependencies [93fdd74]
- Updated dependencies [cdc5103]
- Updated dependencies [86b7c5d]
- Updated dependencies [378dd68]
  - @goodfellow-cms/core@0.10.0

## 0.9.0

### Minor Changes

- e7dd766: New blocks and more from the ones there are. Questions and answers shows questions that open to their answers, and tells search engines about them. The Announcement bar carries news across the top of every page between a first and last day, and visitors can close it until its message changes. Galleries open their pictures larger when clicked, with the arrow keys, buttons and swiping moving between them (new galleries start with it on). Heading blocks carry link names, which On this page now lists on any page, and it can stay in view as the page scrolls. Table cells can be bold, italic or links, which WordPress imports and exports keep. The registry's Map block also shows OpenStreetMap's maps.
- 78f1f14: The media library describes images: **Describe** on the Media screen says what an image shows, in each of the site's languages, kept in `content/media.json`, and images whose blocks leave their description empty use it, on the site, in the editor and in apps through the content API's `site.json`. The Media screen's search finds files by their descriptions too, and **Select files** deletes several files in one publish. `mediaFileChange()` now takes `{ credits, descriptions }`, and `withoutCredits()` is `withoutMediaDetails()`.

### Patch Changes

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
- Updated dependencies [cb72911]
- Updated dependencies [dfd7ea3]
- Updated dependencies [01b7691]
- Updated dependencies [1023c64]
- Updated dependencies [78f1f14]
  - @goodfellow-cms/core@0.9.0

## 0.8.0

### Minor Changes

- 141a23d: Every block's Style settings can hide it on phones (narrower than 640px), tablets (640px to 1023px) or computers (1024px and wider), so a page can show something different on each without writing Tailwind classes. The choice is kept as Tailwind's breakpoint classes (`max-sm:hidden`, `sm:max-lg:hidden`, `lg:hidden`), which `readBlockStyle()` reads as `hiddenOn` and `withBlockStyle()` writes, and apps hide the block on the same sizes of screen, since they now read `max-` breakpoint classes too. The documentation site's header uses it to put the menu button and dark mode switch at the top right on phones and tablets, with the search on a line of its own on phones.
  
  Builds' accessibility checks look at pages that hide blocks on some screens as each size of screen shows them, so a menu for phones and one for computers aren't reported as two parts of the page with the same name.
  
  `SiteImage` gives images the build knows the size of their `width` and `height` even where it doesn't list smaller copies, such as SVG logos in `goodfellow build`, so browsers keep their space before they load, as Next.js's `next/image` already did.

### Patch Changes

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

## 0.7.0

### Minor Changes

- 45a692b: Apps with Expo: `@goodfellow-cms/expo` shows a Goodfellow site natively in an Expo app for iPhone and Android from its content API, with no server. The app reads the manifest when it starts and when it comes back to the front, downloads only what changed and keeps it with its pictures, so it works offline; large sites choose which pages it keeps ahead. It stays on the copy it has when the site's content is newer than it reads. Every built-in block has a version for apps, `nativeBlocks` from `@goodfellow-cms/blocks/native`, sharing its props and what it shows with the website's, and blocks the app has no version of show a placeholder, or the app's own fallback, such as an Expo DOM component. `goodfellow blocks add --native <app>` also makes a block's version for the app with shadcn-tamagui-codemod. The content API's manifest now lists the site's redirects, which the app follows as the website does, and its pages carry their blocks' default props and the page's links to its translations, and the Form block has messages for the app to show once answers are sent or when they couldn't be.
- eaf61e7: Blocks' **Style** applies in apps: their Tailwind classes become React Native styles while the app runs, read with twrnc in the site's theme colors, corners and fonts, with breakpoints' classes on wider screens and `dark:` ones where the site shows dark. Each block is drawn in a box with its space, background and corners, and its text takes its alignment, size and color, which the blocks in its slots inherit, as on the web. Blocks that put their Style on one part of themselves mark it with `stylesItself()` and read `useBlockStyle()`, as Button does; `classStyle()` turns any classes into styles.

### Patch Changes

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
- Updated dependencies [db58e5d]
- Updated dependencies [a52b217]
- Updated dependencies [dd3da3e]
  - @goodfellow-cms/core@0.7.0
