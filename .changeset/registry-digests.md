---
"@goodfellow-cms/registry": patch
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
---

Blocks from Goodfellow's own registry are checked before they're installed. The registry's build writes each item's SHA-256 into `r/digests.json`, the admin panel's build keeps them from the registry built with it, and the Blocks screen and the site import take an item from jsDelivr only where its text has that SHA-256 (`checkedFetchJson()`), saying the block's files aren't the ones Goodfellow released otherwise. `goodfellow update --blocks` checks the blocks it fetched against the digests of the registry npm installed before the site builds.
