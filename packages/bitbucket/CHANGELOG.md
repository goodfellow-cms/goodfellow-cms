# @goodfellow-cms/bitbucket

## 0.11.0

### Patch Changes

- c4ecba5: On GitLab, the job that makes the nightly update or writes a plugin's lockfile, which runs the code of every package the site installs, no longer publishes. The starters' `.gitlab-ci.yml` makes them in a `prepare` job, which only commits, and a `publish` job that runs none of the site's code checks they change only what an update or a lockfile does and publishes them with a deploy key of its own, whose private half only that job gets. Turning on updates on the Updates screen adds the key, lets it publish to the main branch, and turns off job token pushes; the setup page does the same for a code project it creates. A developer copies the starter's `.gitlab-ci.yml` to an older site, after which an owner turns updates on again.
  
  On Bitbucket, the pipeline steps that run the site's code (the lockfile, the nightly update, and plugins' tasks) now ask only to read the repository, so their token can't publish, and a step after each, which runs none of the site's code, checks what they committed and publishes it, as on GitHub. Where the main branch has branch restrictions, add main under its Pipelines write access. A developer copies the newer `bitbucket-pipelines.yml` to an older site.
- f6fcc1a: Goodfellow's documentation is now at https://goodfellowcms.com, and the links the packages give, in their READMEs, the admin panel's help links, and the Claude Desktop extension, go there. The old address, https://goodfellow-cms.github.io/goodfellow-cms/, sends people to the same page at the new one.
- d813bd5: The backends', the command line's, the Claude connector's, create-goodfellow's, and the token broker's English use the Oxford comma in lists ("GitHub, GitLab, or Bitbucket").
- 7698210: Tighten a few things found in the security review:
  
  - The starters' `publish-lockfile` job, and GitLab's lockfile step, refuse a lockfile that takes a package from anywhere but npm's registry that the committed one didn't, as publishing updates already does (`LOCKFILE_REGISTRY_CHECK`). Sites made before this keep their workflows until a developer copies the starter's.
  - On GitLab and Bitbucket, an editor whose view of the site predates someone else's scheduled change no longer removes that change's build: `ScheduledBuilds.sync()` takes the times the admin panel listed last as `known`, and stops a build still to come only where its time is among them.
- e3678d8: Security fixes from the November code review:
  
  - The sign-in service sends a sign-in back only to the admin panel (or the token broker's page), never to another page at the site's address, where an editor's redirect could pass it on to another site, and a link can no longer keep an owner signed in for longer.
  - The Comments block shows Garrul's comments only from the address in Site Settings, which only owners change, since Garrul's script comes from wherever its address says.
  - A token broker asks before publishing a file for the media library that can hold code: an SVG picture, or anything that isn't a kind the media library takes, such as a page or a script.
  - Builds refuse a page whose comment a browser would end before the admin address's guard (`<!-->`, `<!--->` or `--!>`).
  - Plugins' tasks install Goodfellow's task runner at the exact release the site's lockfile has, with nothing npm published more than a day after it. New sites get it in their setup; an update can't change a site's workflows, so an existing site that runs plugins' tasks gets it by copying the starter's `.github/workflows/plugin-task.yml`, or the `plugin-task` job of its `.gitlab-ci.yml`, over its own.
  - Bitbucket invitations match a member by their account or username before the name they show, and refuse a name more than one member uses.
- 0255dbc: More fixes from November's security review:
  
  - The local backend in `goodfellow dev` and `next dev`, and the Claude connector's folders, never follow a link inside an editable folder to files outside it; the folders themselves may still be links, as a content repository's are.
  - The Claude connector's screenshots run the browser in Chrome's sandbox, without the connector's tokens in its environment.
  - A plugin can't ask to read `*`, `.git`, or files of secrets such as `.env.local`, or for Goodfellow's own `GOODFELLOW_` variables.
  - Bitbucket sites' lockfile step publishes `package-lock.json` only once every new package comes from npm's registry, as GitHub's and GitLab's do. Sites made by an earlier release keep their `bitbucket-pipelines.yml` until it's copied from a new site's.
  - WordPress imports take only web addresses for attachments, and importing on a computer downloads them only from public `https://` addresses or the site it was read from, no larger than the upload limit.
  - Expo apps open redirects to other sites only over the web, and take the site's base path only where it's a path.
  - Cleaning an SVG's CSS goes on until taking out an `@import` or `url()` can't join what's around it into another, and leaves the CSS out whole where something would still load from elsewhere, as an unfinished `url(` would.
  - Rich text can't take an id Goodfellow's own scripts look up by spelling it with character references, such as `&#103;f-consent`.
  - A full-stack site's AI proxy (`aiServer()`) sends on only the fields the AI assistant sends: Claude's own models, answers no longer than the assistant asks for, text messages and structured answers, and only its beta, so an editor can't spend the site's key on tools, files, or other models. `models` on a service's key limits the models editors may ask for.
  - GitLab and Bitbucket sites list and close only their own repository's merge and pull requests as drafts' reviews, never one from a fork that uses a draft's branch name.
  - The sign-in worker that `create-goodfellow` carries, which owners deploy, takes its setup page's forms only from that page, and always writes a new session key while it's being set up.
  - The token broker publishes a draft with exactly the changes it checked, so nothing added to the draft in between goes live unchecked, and frames the admin panel at the screen an address names without what a sign-in brought back, such as the sign-in worker's grant or Bitbucket's token.
  - The Claude connector reads a site's description as builds read other sites' files: from public `https://` addresses only (or a folder's development server), no larger than 5 MB, and within 15 seconds.
  - A plugin installed from the admin panel runs its tasks only from its own package, so a task's description can't send its secrets to a file of the site's.
  - The nightly update no longer changes blocks from Goodfellow's registry, and its publishing job on GitHub refuses `blocks/installed/`, `components/`, `lib/`, and `hooks/`, since the job that made the update ran the site's packages, which could have written code there. The Blocks screen offers **Update** where a newer version of an added block is ready, and `goodfellow update --blocks` (or `goodfellow-next update --blocks`) updates them all. GitHub sites made by an earlier release keep their workflow's older check until it's copied from a new site's, since updates can't change workflows.
- db80e2f: The Updates screen counts an update job that only commits as set up only where a later job publishes what it commits, and Bitbucket's last update reads as failed where the step publishing it failed. GitLab's starter Pages job writes the lockfile only where it builds, letting editors publish keeps the publishing key's access to the main branch on older GitLab, and the Updates screen asks to turn updates on again where the main branch's protection no longer names the key.
- Updated dependencies [b26b5ae]
- Updated dependencies [f4a0a43]
- Updated dependencies [44a825d]
- Updated dependencies [810503b]
- Updated dependencies [c4ecba5]
- Updated dependencies [f6fcc1a]
- Updated dependencies [ec40324]
- Updated dependencies [c39766d]
- Updated dependencies [5f09d89]
- Updated dependencies [f287d1c]
- Updated dependencies [3184524]
- Updated dependencies [d7098cb]
- Updated dependencies [bc2f3bd]
- Updated dependencies [7698210]
- Updated dependencies [6210740]
- Updated dependencies [e3678d8]
- Updated dependencies [c7c70ef]
- Updated dependencies [0255dbc]
- Updated dependencies [749d66b]
- Updated dependencies [3bcdfa1]
- Updated dependencies [db80e2f]
  - @goodfellow-cms/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [5c28336]
  - @goodfellow-cms/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [cfa0a83]
- Updated dependencies [93fdd74]
- Updated dependencies [cdc5103]
- Updated dependencies [86b7c5d]
- Updated dependencies [378dd68]
  - @goodfellow-cms/core@0.10.0

## 0.9.0

### Patch Changes

- d0a47cb: Packages' npm descriptions, and the Claude Desktop extension's name, say Goodfellow CMS, the official name, so they're easier to find.
- Updated dependencies [0177574]
- Updated dependencies [d345032]
- Updated dependencies [e7dd766]
- Updated dependencies [19d7812]
- Updated dependencies [58556ef]
- Updated dependencies [b4f074a]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [bff0a8a]
- Updated dependencies [d0a47cb]
- Updated dependencies [1004f6f]
- Updated dependencies [bd82b21]
- Updated dependencies [78f1f14]
- Updated dependencies [d345032]
- Updated dependencies [181d734]
- Updated dependencies [8dcf967]
- Updated dependencies [cf403e0]
- Updated dependencies [9c6cb6f]
- Updated dependencies [19d7812]
- Updated dependencies [19d7812]
- Updated dependencies [0b22859]
- Updated dependencies [19d7812]
- Updated dependencies [cb72911]
- Updated dependencies [dfd7ea3]
- Updated dependencies [01b7691]
- Updated dependencies [1023c64]
- Updated dependencies [78f1f14]
  - @goodfellow-cms/core@0.9.0

## 0.8.0

### Patch Changes

- 27cf03a: Editors signed in with GitLab are no longer signed out when several requests need a new access token at once: they now share one renewal, since GitLab accepts each refresh token only once. Coming back from signing in with GitLab or Bitbucket in a tab that didn't start it now takes the sign-in details out of the address too, so a Bitbucket token never stays in the address bar or history.
- 4010248: Backends list every draft and review, past the first hundred, on GitHub and GitLab. The Bitbucket backend sends its sign-in only to Bitbucket's API, even when an answer names another address. It also reads what others published when its own commit is too far down the branch to find, rather than showing old text. And it refuses a `repo` that isn't `workspace/repository`, as the GitHub backend does.
- Updated dependencies [a341e5f]
- Updated dependencies [8d9d46c]
- Updated dependencies [d21884a]
- Updated dependencies [2e22322]
- Updated dependencies [9ccc5bb]
- Updated dependencies [293bbf0]
- Updated dependencies [46cf9d9]
- Updated dependencies [368f04e]
- Updated dependencies [b9f619e]
- Updated dependencies [65239e6]
- Updated dependencies [b072536]
- Updated dependencies [141a23d]
- Updated dependencies [ecfbab6]
- Updated dependencies [8622adc]
- Updated dependencies [90e3369]
- Updated dependencies [7a9a116]
- Updated dependencies [5869562]
- Updated dependencies [5113b06]
- Updated dependencies [4e12d00]
- Updated dependencies [1a25a31]
- Updated dependencies [e558acd]
- Updated dependencies [4744a5f]
- Updated dependencies [9731fc0]
- Updated dependencies [86ad949]
- Updated dependencies [7be53b5]
- Updated dependencies [fcb4100]
- Updated dependencies [51a992a]
- Updated dependencies [a10f9ae]
- Updated dependencies [5e9a95b]
- Updated dependencies [1335733]
  - @goodfellow-cms/core@0.8.0

## 0.7.0

### Minor Changes

- 42cf54b: Owners can limit what each editor changes, on the Editors screen's Limits section: page sections with their translations, collections' items, the media library, the header and footer, the menus, and languages, kept in `content/permissions.json`. Everything else is read-only to them, and publishing changes outside their limits offers Submit for review, which asks the site's reviewers (every owner, unless the file names some) on GitHub, GitLab and Bitbucket. Owners see drafts waiting for their review in the draft bar, and publishing or throwing away a draft closes its review. The token broker and the Claude connector keep to the same limits, and full-stack sites' servers refuse writes outside them. The sign-in service's everyday app now asks for Pull requests, which submitting for review needs.

### Patch Changes

- 4f79454: The Claude connector on your computer works on several sites at once, with a token for each host, and on sites in folders on your computer through their development server. It finds a site's address on GitHub Pages or GitLab Pages when Site settings has none, and its screenshots no longer wait for pages to go quiet for good, run without the GPU, are tried again when the browser closes, and say what the browser said. Backends wait and try again when a host limits requests (`withRateLimits()`, `RateLimitError`), and the GitLab backend no longer lists the whole site again after each of its own saves.
- Updated dependencies [c6afe19]
- Updated dependencies [a8e3581]
- Updated dependencies [48366cf]
- Updated dependencies [8f7fa14]
- Updated dependencies [4f79454]
- Updated dependencies [3bb8c96]
- Updated dependencies [cedcb3a]
- Updated dependencies [42cf54b]
- Updated dependencies [45a692b]
- Updated dependencies [45a692b]
- Updated dependencies [db58e5d]
- Updated dependencies [a52b217]
- Updated dependencies [dd3da3e]
  - @goodfellow-cms/core@0.7.0

## 0.6.0

### Minor Changes

- 1b9781e: Sites stored on Bitbucket Cloud, with `@goodfellow-cms/bitbucket`: sign-in with a repository access token, an Atlassian API token or Bitbucket's own sign-in, publishing as one commit that fails when someone else has published since, version history, drafts and pull requests, editors from the workspace, failed rebuilds explained, the nightly update, scheduled changes that go live at their time (each with a one-off Pipelines schedule) and plugins' tasks through Bitbucket Pipelines, and content in a repository of its own, with Vercel putting the site online. `create-goodfellow --bitbucket` creates such sites, with `--content` too, `goodfellow due` and `goodfellow-next due` take `--output`, and the token broker, the Claude extension, the Claude connector service and the admin panel know Bitbucket too.

### Patch Changes

- Updated dependencies [1b9781e]
- Updated dependencies [3436a92]
- Updated dependencies [2f6c59e]
- Updated dependencies [f591bc0]
- Updated dependencies [6bf08ae]
- Updated dependencies [b803050]
- Updated dependencies [4c909ac]
- Updated dependencies [11a429f]
- Updated dependencies [be7bbec]
- Updated dependencies [b9b0434]
  - @goodfellow-cms/core@0.6.0
