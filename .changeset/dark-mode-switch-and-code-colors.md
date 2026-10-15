---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/next": minor
---

A Dark mode switch block lets visitors choose light or dark colors on sites with dark mode, as a switch (with or without the words Light and Dark) or a menu that can also follow their computer. Their choice is kept in their browser and put back before each page shows. Sites choose their code colors in Site Settings → Colors & fonts → Code colors, from Shiki's color schemes for light and for dark, and can show code on the site's subtle background color. Code on light-only sites now carries only its light colors.

Next.js sites made from the starter before this need `suppressHydrationWarning` on `<html>` in `app/layout.tsx` to use the Dark mode switch without a warning in `next dev`.
