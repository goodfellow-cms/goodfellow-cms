---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"@goodfellow-cms/registry": minor
"@goodfellow-cms/react": minor
---

On sites kept on GitHub, Site Settings has a Comments screen that sets up comments: it makes a public repository of their own beside the site's, with Discussions turned on, or connects one you already have, and publishes where they're kept as `content/site.json`'s `comments`, which the Comments block now shows without Giscus's code. The same screen lists visitors' comments page by page, and hides, shows and deletes them and closes pages to new ones. Where the sign-in can't reach that repository, as with the sign-in service, it asks for a GitHub token of the owner's own, kept only in the tab. GitHub backends offer this as `comments` (`SiteComments`), and the token broker asks before making the repository or deleting a comment.
