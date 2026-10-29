---
"create-goodfellow": patch
---

New sites' `.gitignore` leaves out `.env` as well as `.env*.local`, so environment files with secrets aren't published by accident.
