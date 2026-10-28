---
"@goodfellow-cms/expo": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Apps with Expo: `@goodfellow-cms/expo` shows a Goodfellow site natively in an Expo app for iPhone and Android from its content API, with no server. The app reads the manifest when it starts and when it comes back to the front, downloads only what changed and keeps it with its pictures, so it works offline; large sites choose which pages it keeps ahead. It stays on the copy it has when the site's content is newer than it reads. Every built-in block has a version for apps, `nativeBlocks` from `@goodfellow-cms/blocks/native`, sharing its props and what it shows with the website's, and blocks the app has no version of show a placeholder, or the app's own fallback, such as an Expo DOM component. `goodfellow blocks add --native <app>` also makes a block's version for the app with shadcn-tamagui-codemod. The content API's manifest now lists the site's redirects, which the app follows as the website does, and its pages carry their blocks' default props and the page's links to its translations, and the Form block has messages for the app to show once answers are sent or when they couldn't be.
