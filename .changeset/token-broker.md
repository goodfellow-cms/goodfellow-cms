---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
"create-goodfellow": minor
---

The token broker: a sign-in page on an address of its own, released as `@goodfellow-cms/broker`, which keeps editors' GitHub or GitLab sign-in and AI keys, shows the admin panel in a frame and makes every call to the git host and AI services for it, so nothing on the site's address can read them. It asks the editor in its own part of the page before publishing the site's code, custom code or a new Site address, installing a release or giving someone access, never changes workflows, and asks for owner tokens itself. The config's new `broker` line, which Site Settings' Security tab sets, makes the admin panel open only inside the broker, which the sign-in worker then gives tokens to alone. With a broker, the Blocks screen offers the config's other registries too. The admin address's guard and header rules let the broker frame the admin panel.
