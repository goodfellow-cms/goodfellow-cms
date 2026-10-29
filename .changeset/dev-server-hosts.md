---
"@goodfellow-cms/core": patch
"goodfellow": patch
---

`goodfellow dev` and `next dev`'s local backend now refuse requests to any name other than this computer's (`localhost`, its IP addresses, and Vite's `server.allowedHosts`), so a website that points its own name at your computer can't save to your files through the admin panel's API. The terminal's "Saved:" line leaves out control characters.
