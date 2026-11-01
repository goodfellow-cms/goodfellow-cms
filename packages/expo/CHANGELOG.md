# @goodfellow-cms/expo

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
