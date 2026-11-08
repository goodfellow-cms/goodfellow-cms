---
"@goodfellow-cms/github": patch
---

Signing in with a sign-in service now brings the one-time grant back after the address's `#`, so it never reaches the site's host or its logs. Sign-in services from before still work: their grant comes back in the query, as before.
