# @goodfellow-cms/expo

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
