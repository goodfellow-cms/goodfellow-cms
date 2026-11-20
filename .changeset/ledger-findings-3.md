---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/next": patch
"goodfellow": patch
"create-goodfellow": patch
---

Security and correctness fixes:

- In Custom HTML used exactly as written, an item's value no longer goes into an address the page design itself starts with `javascript:` or `data:`, where the browser would run it.
- The full-stack example's deploy job downloads what the build made into a folder of its own, and takes only `dist/` and the build's config from it, so a file of the build's own, such as a `.env` that sends wrangler's requests elsewhere, never reaches the job that holds the Cloudflare token. Sites made before this keep their `.github/workflows/deploy.yml`: copy the example's download step, with its `path`, its **Check what the build handed over** step, and `scripts/check-build.ts`.
- With an admin address, builds stop at a file that starts as a page does under a name that doesn't say so, such as a `.txt` that starts `<html>`, which GitLab Pages would serve as a page, and guard more kinds of XML file. The media library refuses such files, a site import leaves them out, and the token broker asks before publishing one.
- A Bluesky post's address with a stray `%` no longer stops its page, or a static site's build.
- A theme's install screen lists every address its header and footer would load, whatever it ends in, and in `srcset` (read as browsers read it, commas and character references included) or unquoted attributes, and no longer counts links or words that are an address.
- Plugins' build steps and tasks can't be given `.env` files, `.git`, `.npmrc`, or `.netrc` in another letter case or a Windows short name, or a folder holding one or a link out of it, and a plugin can't keep the site's media unless that was approved.
- A site import says when pages come in with blocks set as only owners would, such as Custom HTML used exactly as written, or with a visit counter's script.
- A publish that would leave a content file the site can't read is stopped, naming the file in the admin panel's language, with the technical reason behind Details, unless someone else's change had already left it so.
