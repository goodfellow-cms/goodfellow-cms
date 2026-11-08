---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
---

Tighten a few things found in the security review:

- The starters' `publish-lockfile` job, and GitLab's lockfile step, refuse a lockfile that takes a package from anywhere but npm's registry that the committed one didn't, as publishing updates already does (`LOCKFILE_REGISTRY_CHECK`). Sites made before this keep their workflows until a developer copies the starter's.
- On GitLab and Bitbucket, an editor whose view of the site predates someone else's scheduled change no longer removes that change's build: `ScheduledBuilds.sync()` takes the times the admin panel listed last as `known`, and stops a build still to come only where its time is among them.
