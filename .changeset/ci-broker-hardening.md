---
"@goodfellow-cms/core": patch
"@goodfellow-cms/broker": patch
"@goodfellow-cms/next": patch
---

The nightly update's publish job publishes only what an update changes, with packages only from npm's registry; plugins can't ask for CI services' and hosts' own variables; the token broker asks before showing the admin panel from a new address, and can be held to one in `broker.json`; and the sign-in worker revokes a code repository's token whatever stops it being given.
