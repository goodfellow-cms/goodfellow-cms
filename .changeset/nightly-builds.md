---
"@goodfellow-cms/core": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Sites rebuild overnight only when visitors would see something new. Every build writes `goodfellow-build.json` with what it was built from and when what it shows by today's date next changes, and the starters' setups run `goodfellow nightly` (or `goodfellow-next nightly`) first each night, building only when there are fixes to install, something dated has changed, or the live site isn't the newest build. On GitLab Pages, a night with nothing new publishes the live site's files again. The Updates screen lets owners choose to rebuild overnight only when something changed, every night or never, and has Rebuild now. On GitHub the choice is the `GOODFELLOW_NIGHTLY` repository variable, which the sign-in service's owners' app now asks for the Variables permission to set.
