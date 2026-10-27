---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/bitbucket": minor
"@goodfellow-cms/mcp": minor
"@goodfellow-cms/broker": minor
---

Owners can limit what each editor changes, on the Editors screen's Limits section: page sections with their translations, collections' items, the media library, the header and footer, the menus, and languages, kept in `content/permissions.json`. Everything else is read-only to them, and publishing changes outside their limits offers Submit for review, which asks the site's reviewers (every owner, unless the file names some) on GitHub, GitLab and Bitbucket. Owners see drafts waiting for their review in the draft bar, and publishing or throwing away a draft closes its review. The token broker and the Claude connector keep to the same limits, and full-stack sites' servers refuse writes outside them. The sign-in service's everyday app now asks for Pull requests, which submitting for review needs.
