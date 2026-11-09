---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/admin": minor
---

Full-stack sites' API now runs on servers without Node, such as Cloudflare Workers. `appApi()` comes from the new `@goodfellow-cms/core/server` entry, which uses Web `Request` and `Response` and nothing from Node, and `goodfellowApi()` uses it.

Checking plugin and theme updates installed before they're three days old needs Node, so it's now an option: pass `provenance: nodeProvenance()` (from `@goodfellow-cms/core/node`) to `goodfellowApi()` to keep checking them. Without it, the server refuses them (`early-unavailable`), and the admin panel doesn't offer **Install now** on that site, so updates wait until they're old enough. `appApi()` from `@goodfellow-cms/core/node` still checks them by default. `AppApiOptions.provenance` is now a check function (`nodeProvenance(options)`) instead of its options.
