---
"@goodfellow-cms/expo": minor
"@goodfellow-cms/blocks": minor
---

Blocks' **Style** applies in apps: their Tailwind classes become React Native styles while the app runs, read with twrnc in the site's theme colors, corners and fonts, with breakpoints' classes on wider screens and `dark:` ones where the site shows dark. Each block is drawn in a box with its space, background and corners, and its text takes its alignment, size and color, which the blocks in its slots inherit, as on the web. Blocks that put their Style on one part of themselves mark it with `stylesItself()` and read `useBlockStyle()`, as Button does; `classStyle()` turns any classes into styles.
