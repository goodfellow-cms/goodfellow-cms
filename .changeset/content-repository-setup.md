---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
---

Finishing content in a repository of its own (roadmap step 25).

- The setup page offers it under "Where to keep the content". It creates the code's repository and the content's, and connects them: on GitHub, private repositories get read-only deploy keys, with their private halves as Actions secrets of the repository that reads them; on GitLab, each project joins the other's job token allowlist, and the code project's job token may publish updates, with a nightly pipeline schedule. `SetupAccount.createSite()` takes `more` and `link` for this, and `separateSetupLinks()` says what connects a site's repositories.
- `github({ repo, contentOnly: true, code })` and `gitlab({ project, contentOnly: true, code })` name the code repository, which new sites' configs now do, and the Updates screen follows its update job: the site's release, running updates and the last run, for people who can see it (`SiteUpdates.code`, and `no-access` where they can't). Going back to an older release from the Updates screen also skips the release it left. On GitHub, the sign-in service gives a second token for the code repository, which can only read it and its workflow runs, or for owners, run them.
- The GitHub setup page's token links ask for Secrets as well, for the deploy keys.
