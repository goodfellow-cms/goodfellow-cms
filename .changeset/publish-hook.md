---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
---

Full-stack sites can do something after each publish from the admin panel: `goodfellowApi({ onPublish })`, and `appApi()`'s `onPublish`, is given the files a publish changed, who published them, and the new revision. A failure goes to `onError`, since the publish has already happened.
