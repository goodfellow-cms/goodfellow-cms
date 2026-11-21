---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/broker": patch
"@goodfellow-cms/admin": patch
---

Security and correctness fixes:

- With an admin address, a build now stops at any file that starts with `<` under a name a host may type by its content. Before, only a `<` followed by an ASCII letter, `!`, `?`, or `/` counted, so an XML file whose root element's name starts with `_` or a letter outside ASCII got past the check. Uploads, imports, and the token broker's question check files the same way.
- A theme's install screen now lists an address such as `https:tracker.example/pixel`. Without its slashes, an address like that stays on the site for visitors at `https://`, but goes to another site for visitors at `http://`.
- The token broker asks about the domain a call actually changes. It refuses a domain name that isn't spelled as one. On GitHub Pages, which secures or removes the site's own domain whatever name it's given, it refuses any name but the site's own. When securing a domain makes it the one visitors are sent to, the question says so.
- Comment moderation can't reach other repositories. The GitHub backend's `comments` hides, shows, deletes, locks, and unlocks only comments and pages its `threads()` listed. Through the token broker, `threads()` lists the repository the site's settings name, whatever the admin panel asked for. `comments.find()` turns Discussions on only when asked to with `turnOn`. The Comments screen asks for it, and the token broker asks before allowing it.
- The token broker's Publish and Allow buttons work only a second after a question appears, and again after the window comes back into focus, so a click timed by the admin panel's frame can't answer a question.
- AI answers through the token broker now arrive as they're written, so the assistant shows its progress. If sending the request fails, or the answer breaks off, the admin panel is told instead of waiting. Stopping a request stops the broker's request too. Older admin panels and brokers still work with newer ones.
