/** Everything the broker's page says, in one place, so it can be reworded or translated. */
export const STRINGS = {
  title: "Sign in",
  loading: "Loading…",
  framed: "This page can't be shown inside another page. Open it on its own.",
  noConfig:
    "This sign-in page isn't set up yet: it needs a broker.json beside it, naming the site it signs in to. See the token broker page in Goodfellow's documentation.",
  signInTitle: "Sign in to edit {site}",
  signInIntro:
    "This page keeps your sign-in and AI keys where the site's pages can't reach them, and shows the admin panel from here.",
  signInRedirect: "Sign in with {host}",
  signInToken: "Or sign in with an access token",
  tokenLabel: "Access token",
  remember: "Stay signed in on this device",
  signInButton: "Sign in",
  signingIn: "Signing in…",
  signInError: "That didn't work: {message}",
  noSiteAddress:
    "The site has no address yet, so there's no admin panel to show. Set its address in Site Settings first, or ask its owner to.",
  badSiteAddress: "The site's address, {address}, isn't one this page can show the admin panel from.",
  signedInAs: "Signed in as {name}",
  aiKeys: "AI keys",
  signOut: "Sign out",
  adminFrame: "Admin panel",
  confirmTitle: "Publish this?",
  confirmIntro:
    "The admin panel asked to publish changes that need you to say so here, where nothing it runs can say so for you:",
  confirmCode: "The site's code, which runs when the site is built:",
  confirmCustomCode: "Code that runs on the site's pages:",
  confirmSiteAddress:
    "A new Site address, which is where this page shows the admin panel from. Only publish it if you changed it yourself:",
  confirmUpdate: "Installing Goodfellow {release}, which changes the site's packages.",
  confirmPlugin:
    "Installing the plugin {title} ({name} {release}), whose code is included when the site is built and runs on its pages. It asks to:",
  confirmPluginRemove: "Removing the plugin {name}.",
  pluginConnect: "Reach these addresses from the admin panel: {list}",
  pluginFiles: "Read and publish these files: {list}",
  pluginSecrets: "Get these secrets when the site is built: {list}",
  pluginRead: "Read these parts of the site when it's built: {list}",
  pluginWrite: "Write these parts of the built site: {list}",
  pluginBlocks: "Add these blocks: {list}",
  pluginAdmin: "Run in the admin panel, in a frame of its own",
  pluginBuild: "Run steps when the site is built",
  pluginServer: "Answer requests on the site's server, with everything the server can do",
  pluginEditor: "Offer its own page editor, {title}, which is given what's edited in it",
  pluginNothing: "Nothing more",
  confirmEditors: "Giving {who} access to edit the site{role}.",
  confirmEditorsPublish: "Letting the site's editors publish to it.",
  confirmPublish: "Publish",
  confirmAllow: "Allow",
  cancel: "Cancel",
  refusedLimits:
    "An owner has limited what you can change on this site, and this publish changes things outside it: {paths}. Submit it for review instead.",
  refusedWorkflow: "The token broker never changes the site's workflows, which run with its secrets: {paths}.",
  declined: "You chose not to publish this.",
  ownerTitle: "Owner token",
  ownerIntro:
    "Create a token that can manage the site, then paste it here. This page keeps it for as long as it's open, and the admin panel never sees it.",
  ownerCreate: "Create a token",
  ownerLabel: "Owner token",
  ownerUse: "Use this token",
  aiTitle: "AI keys",
  aiIntro:
    "The AI assistant asks these services through this page, with your keys, so the admin panel never sees them. Leave a service empty to not use it.",
  aiRemember: "Remember these keys on this device",
  aiSave: "Save",
} as const;

export type StringKey = keyof typeof STRINGS;

/** A string with its `{placeholders}` filled in. */
export function t(key: StringKey, values: Record<string, string> = {}): string {
  return STRINGS[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
