---
"create-goodfellow": patch
---

`create-goodfellow`'s build copies the starter and the parish and Next.js examples from the files git keeps, as it already did the company example, so a `.env.local` left from trying a plugin, or anything else `.gitignore` leaves out, can never be published with it. The build also stops where a bundled template still has a file that looks like a secret (`.env`, `.env.*`, or `.dev.vars`, but for their `.example` files).
