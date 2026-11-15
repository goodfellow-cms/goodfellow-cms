---
"create-goodfellow": patch
---

The sign-in service can sign as its GitHub Apps with the private keys GitHub gives them. GitHub gives them as PKCS#1, which Workers' Web Crypto can't read, so every token the service made failed, and editors and the setup page saw that it was unavailable. It now converts them itself, so services already set up work once they're updated, and the Claude connector service does the same.

It also waits for GitHub to let the owners' app reach a repository the setup page has just created, for up to about 15 seconds, instead of saying it's unavailable and leaving the new repository with only its README. A token for a repository GitHub can't reach yet is no longer asked for again without the Secrets permission, so the setup page gets Secrets wherever the owners' app has it. When GitHub answers in a way the service doesn't expect, its logs now say which request GitHub refused and what GitHub said, never with a token.
