---
"@goodfellow-cms/github": minor
"@goodfellow-cms/core": minor
"create-goodfellow": patch
---

Full-stack sites made on the setup page now publish with a GitHub App of their own, which the page makes and installs on the content repository alone, so nobody makes or renews a token by hand. `@goodfellow-cms/github/app` makes the app's manifest and turns GitHub's answer into its key (`publishingAppManifest()`, `convertAppManifest()`), and gives the site's server hour-long tokens for the content repository only (`publishingAppToken()`), each made once the installation is checked: not on all repositories, on no others, and with no permissions besides Contents (`publishingToken()`, `checkPublishingApp()`, `PublishingAppError`).

The setup page saves the app's key and the Cloudflare token you paste as the code repository's secrets and starts Set up Cloudflare itself, through `SetupAccount`'s new `saveSecrets()`, `startWorkflow()`, and `readFile()`, and links to the site's `/setup/` page with the setup code in the address's fragment, which the page takes out at once.

The company example, which `--server cloudflare` starts from, publishes with the app's `GOODFELLOW_APP_ID` and `GOODFELLOW_APP_KEY`, or else `GOODFELLOW_GIT_TOKEN`. Its Deploy workflow runs each night, so new photos reach the site, puts only the main branch's newest commit online, and gives the Worker the site's domain where its zone is on the Cloudflare account. Set up Cloudflare finds the account the token is for and writes its id into `wrangler.jsonc`. The content repository no longer has a workflow or a token that starts the code's builds (`deploySiteWorkflow()` is gone).
