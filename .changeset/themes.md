---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
---

Install themes from npm. Site Settings has a Themes screen that finds packages named `goodfellow-theme-<name>`, previews one on the site, and installs it: its colors, fonts and parts' classes go into the site's settings, its CSS goes at the start of the custom CSS, and its header and footer replace the site's if the owner chooses. A record in `content/styles/theme.json` lets updates replace only what nobody has changed since. A release is offered once it's three days old and only if its `peerDependencies` range on `@goodfellow-cms/core` includes the site's release. The Updates screen says when a newer Goodfellow release is outside the installed theme's range.
