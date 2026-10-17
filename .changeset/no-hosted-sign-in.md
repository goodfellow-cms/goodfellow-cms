---
"@goodfellow-cms/github": minor
"@goodfellow-cms/admin": patch
---

Goodfellow doesn't run a hosted sign-in service yet, so `github()` and `githubSetup()` no longer default to one: without `signIn`, editors sign in with a token, as they always could. Sites that run their own sign-in service name its address in `github({ signIn })`, as before. `GOODFELLOW_SIGN_IN` is removed.
