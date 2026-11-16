---
"create-goodfellow": patch
---

The sign-in service's Deploy to Cloudflare copy updates itself only to a newer release: the highest version that's been out a day, never past npm's latest tag or a deprecated release, never one lower than it has, and only where npm's signature and provenance show Goodfellow's own release workflow built it.
