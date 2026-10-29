---
"@goodfellow-cms/core": patch
"goodfellow": patch
---

`goodfellow update` installs only the packages npm had a day after the release it installs came out (`npm install --before`), so a package published, or taken over, since then isn't installed into every site that updates overnight.
