---
"create-goodfellow": patch
---

The sign-in service waits for GitHub to let the owners' app reach a repository the setup page has just created, for up to about 15 seconds, instead of saying it's unavailable and leaving the new repository with only its README. A token for a repository GitHub can't reach yet is no longer asked for again without the Secrets permission, so the setup page gets Secrets wherever the owners' app has it. When GitHub answers in a way the service doesn't expect, its logs now say which request GitHub refused and what GitHub said, never with a token.
