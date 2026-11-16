---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/broker": patch
---

**Add a token broker** checks the page it copies. The broker's build writes each file's SHA-256 into its `files.json`, the admin panel's build keeps them from the broker built with it, and `fetchBrokerRelease()` takes them as `digests`, refusing a file that isn't the released one, or a list with files added or missing, before anything is committed.
