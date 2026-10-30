# @goodfellow-cms/expo

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
