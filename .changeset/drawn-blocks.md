---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
---

Editor plugins can have blocks drawn by the site's own code: `session.draw(block)` gives one block's HTML as the site draws it, in the page edited, with each of its slots left as an empty `<gf-slot data-slot="…">` (`DRAWN_SLOT_ELEMENT`) for the editor to put the slot's blocks in, and `session.styles()` gives the site's stylesheets with the theme's colors and fonts, and Tailwind's source, so an editor without the blocks' code can show them as they look on the site.
