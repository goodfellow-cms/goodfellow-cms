---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/blocks": patch
---

Translations keep the schedule of the page or item they copy; each language's feeds name their own address; a calendar list no longer reports a day already past for an event that runs past its end; impossible dates such as February 30 are refused; rich text with only a picture, video, line or table isn't empty; a turned phone photo's width and height are read the way it's shown; uploads always lose a JPEG's Exif, and PNGs' and WebPs' details too; redirects can't take `/sitemap.xml` or `/robots.txt`, and a redirect that differs from a page or another redirect only in capitals isn't written; the site checks read redirects' old addresses as visitors' links reach them; and the media library finds files used in menus, other languages' headers and footers, code and redirects, never counting a file whose name only starts the same.
