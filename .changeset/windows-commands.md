---
"@goodfellow-cms/core": patch
"goodfellow": patch
---

On Windows, `goodfellow update --commit` and `--publish` no longer fail on the commit message, and `goodfellow blocks add` keeps addresses with `&` in them whole: npm and npx get their arguments quoted for cmd.exe, and git runs without a shell. `goodfellow dev` no longer watches `content/` and `public/media/` on Windows, which reloaded the admin panel in the middle of publishing.
