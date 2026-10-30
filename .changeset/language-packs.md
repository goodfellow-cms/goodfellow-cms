---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
---

Language packs: the admin panel's text in a language, shared on npm as `goodfellow-language-<name>` with no code, which owners find, install, update and remove on Site Settings → Admin panel languages. Installing one writes its words into the site's `content/admin-text/<code>.json`, keeping any the owner wrote or changed, and an update replaces only the pack's words nobody has changed since. Core adds `searchLanguagePacks()`, `languagePackReleases()`, `fetchLanguagePack()`, `planLanguagePack()` and the testing fakes `fakeLanguagePacks()` and `sampleLanguagePackFiles()`.
