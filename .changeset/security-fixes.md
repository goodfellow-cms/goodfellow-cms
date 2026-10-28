---
"@goodfellow-cms/admin": patch
"@goodfellow-cms/core": patch
---

Uploaded SVGs keep only SVG's own drawing elements and safe attributes, so scripts written with another prefix, links to scripts spelled with entities and animations that set links are removed. A plugin's server requests stay under its own address, however `..` is spelled. The token broker asks about a new Site address however the site's settings are written, and when they're deleted.
