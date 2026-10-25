---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/next": minor
"create-goodfellow": minor
---

Install plugins from the admin panel. Site Settings → Plugins finds `goodfellow-plugin` packages on npm, offers releases at least three days old that say they work with the site's Goodfellow release, and shows what each asks to do (its `goodfellow-plugin.json`) and what its packages' code could do: network requests, other programs, code made from text, native code and install scripts. Installing adds the package to `package.json` at an exact release and records what was approved in `plugins/installed/`, whose `index.ts` sites' configs import as `installedPlugins`; a plugin asking for more than that stops the site from loading. It's offered at a checked admin address or with a token broker, whose own dialog names the plugin and what it asks to do; full-stack sites submit it for review. The starters' workflows, and Cloudflare Pages' generated ones, write `package-lock.json` with `npm install --package-lock-only --ignore-scripts`, running none of the new code, and build the site with it. The Updates screen warns about releases outside an installed plugin's range, and `create-goodfellow --plugin` installs plugins in new sites. Sites made earlier need the starter's `deploy.yml` or `.gitlab-ci.yml` before the Plugins screen installs anything.
