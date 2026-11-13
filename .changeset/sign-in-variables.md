---
"@goodfellow-cms/github": patch
---

The owner token link asks for the Variables permission by GitHub's name for it, `actions_variables`, so the token it makes can change when the site rebuilds overnight. The sign-in service's owners' app asks for it the same way, since GitHub refuses an app that asks for `variables`, and its setup finds the service's address on a custom domain.
