---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/next": patch
"create-goodfellow": patch
---

Full-stack Next.js sites submit owners' changes to the site's code, such as adding blocks on the Blocks screen, for review by default, since their server runs that code with its token and keys; `goodfellowApi({ codeChanges: "publish" })` lets owners publish them. The sign-in service says the app isn't installed as soon as it's uninstalled, rather than that signing in isn't working. New sites' setup asks whether you have a domain, starts with an admin address where you do and the host can serve one, and otherwise recommends a sign-in page of its own; the Security and Code tabs say when editors' sign-in is within reach of the site's pages.
