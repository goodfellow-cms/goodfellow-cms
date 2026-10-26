---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Editor plugins' frames are the editor's alone: they keep the admin panel's colors and font but no longer get a screen's spacing or plain element styles, which reached the site's blocks drawn in them. Their policy lets them load the theme's Google Fonts, as the standard editor's frames do, and `session.styles()` gives the fonts' stylesheet as `fonts`.
