---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/mcp": patch
---

Full-stack sites can render pages from their repository as it is now, so a publish shows once its pages render again, without a rebuild: `goodfellowPages(config, { source })` reads pages' content from the source given, such as `repositorySource(git)` from `@goodfellow-cms/core`, which reads every content file once per revision of the live branch, in as few requests as the host allows. `builtSource()` reads Site settings from any source as a build of this copy of the site does, and `prefetchedSource()` reads a folder up front, which the Claude connector now uses to read the whole site.
