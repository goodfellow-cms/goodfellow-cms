import {
  type AdminSite,
  type AppRole,
  adminOrigin,
  ConflictError,
  type ContentStore,
  type DemoStore,
  type DeployStatus,
  type Draft,
  DraftError,
  describedConfig,
  type FileChange,
  type GitBackend,
  type GitUser,
  GOODFELLOW_REGISTRY,
  goodfellowRegistryUrl,
  isDemoStore,
  keptDrafts,
  loadSiteContent,
  MEDIA_DIR,
  type MediaStorage,
  newDraftName,
  type OwnerAccess,
  type PagesDomains,
  PluginTaskError,
  type PluginTaskRequest,
  type PluginTasks,
  type RegistrySources,
  type RepositoryVisibility,
  type ScheduledBuilds,
  ScheduledBuildsError,
  type SetupHost,
  SHADCN_NAMESPACE,
  SHADCN_REGISTRY,
  SignInError,
  type SiteContent,
  type SiteDrafts,
  type SiteEditors,
  type SiteUpdates,
  upcomingChanges,
  writeChanges,
} from "@goodfellow-cms/core";
import type { MediaFieldKind } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChecksDialog } from "./checks-dialog.js";
import { browserDraftKeeper, rememberDraft, rememberedDraft } from "./drafts.js";
import {
  type FrameClient,
  type FrameServices,
  FrameServicesProvider,
  type FrameSource,
  frameSiteCode,
  SiteCodeFrame,
} from "./frame/host.js";
import { allMedia, mediaUrl } from "./media.js";
import { MediaPickerDialog } from "./media-library.js";
import { createMediaPreviews, type MediaPreviews } from "./media-previews.js";
import { type PluginHost, PluginServices } from "./plugin-frames.js";
import { pluginSecretsHelp } from "./plugin-secrets.js";
import { REGISTRY_VERSION } from "./registry-version.js";
import { navigate } from "./router.js";
import { useScheduleInfoOf } from "./schedule.js";
import { checkPublish, type PublishChecks } from "./site-checks.js";
import type { SiteCodeService } from "./site-code.js";
import { showSiteIcon } from "./site-icon.js";
import { StringsProvider, useStrings, useStringTable } from "./strings.js";
import { useThemeChoice } from "./theme.js";

/** How previews load the site's styles. Provided by the dev server or build that serves the admin panel. */
export interface PreviewOptions {
  /** The site's compiled stylesheets. */
  stylesheets: string[];
  /** `@goodfellow-cms/react/theme.css`, so Tailwind in the preview knows the theme's classes. */
  themeCss: string;
  /** URL of `@tailwindcss/browser`, which styles classes typed in the editor before the site is rebuilt. */
  tailwindBrowserUrl?: string;
}

export type LoadState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      content: SiteContent;
      revision: string;
      media: string[];
      /**
       * Counts the times the admin panel has opened a draft or gone back to the
       * live site, so screens start again from what's loaded after each.
       */
      view?: number;
    };

/**
 * How a publish went. `checks` means the site checks stopped it, or the editor
 * went back to fix what they found: their dialog has said why, so screens say
 * nothing more.
 */
export type PublishResult = { ok: true } | { ok: false; reason: "conflict" | "error" | "checks"; error: unknown };

/** Whether the latest publish has reached the live site. `previous` is the revision before it. */
export type DeployProgress = { revision: string; previous?: string } & DeployStatus;

/** Unpublished changes kept to publish together, which every screen shows. */
export interface DraftsValue {
  /**
   * Whether drafts are kept in this browser, where the backend has none of its
   * own (full-stack sites, demos, the development servers): other editors
   * don't see them, and they can't be submitted for review.
   */
  kept: boolean;
  /** The drafts there are, newest first: other editors' and Claude's too. */
  names: string[];
  /** The draft being worked in, which every publish goes into, with the files it has changed. */
  current?: { name: string; paths: string[] };
  /** Works in a draft, or on the live site again without one. Returns `false` where the draft has gone. */
  open(name: string | undefined): Promise<boolean>;
  /** Runs the publish checks over every file in the draft, then publishes it in one save. */
  publishAll(): Promise<PublishResult>;
  /** Opens a pull or merge request for the draft. */
  submit(): Promise<{ ok: true; url: string } | { ok: false; error: unknown }>;
  /** Throws the draft away, leaving the live site as it is. */
  discard(): Promise<{ ok: true } | { ok: false; error: unknown }>;
}

/** The signed-in person, when the admin panel is connected to a git host. */
export interface Account {
  user: GitUser;
  hostName: string;
  /** Whether editors sign in by being sent to the host and back to addresses listed with the host, which a new domain must be added to. */
  redirectAddressesListed: boolean;
  /** Absent where the site's own sign-in has no address for signing out. */
  signOut?(): void;
  /**
   * On a full-stack site, what its own sign-in lets them do: `editor`s don't
   * change Site Settings, blocks, or collections' settings and templates.
   */
  role?: AppRole;
  /**
   * On a full-stack site, the AI services its server asks with keys of its own,
   * at `server`; with a token broker, those the broker keeps keys for, asked
   * through `fetch`, which sends the requests to the broker.
   */
  ai?: { server: string; services: string[]; fetch?: typeof fetch };
  /** Creates another repository on the site's host, such as its token broker's, with a token the owner pastes. */
  setup?: () => SetupHost;
  /** On a full-stack site, where its server answers for plugins, such as `https://example.org/api/goodfellow/plugins`. */
  plugins?: string;
  /** On a full-stack site, for its owners: submits changes for a developer to review, as installing a plugin does. */
  review?(
    changes: FileChange[],
    details: { title: string; description?: string; from: string },
  ): Promise<{ url: string }>;
}

export interface AdminContextValue {
  /** What the admin panel knows about the site without its code. */
  site: AdminSite;
  /** The site's blocks as far as their fields go, for finding links in content. */
  blocks: Record<string, ComponentConfig>;
  /** The site's own code, run in a frame of its own, for the pages blocks add and the checks that render pages. */
  code: SiteCodeService;
  preview: PreviewOptions;
  siteUrl: string;
  state: LoadState;
  account?: Account;
  deploy?: DeployProgress;
  /** Where to show media from in the admin panel, including files the live site doesn't have yet. */
  mediaPreviews: MediaPreviews;
  reload(): Promise<void>;
  /**
   * Saves changes as one commit, then reloads the site's content. The site
   * checks run first, unless `checks` is `false`: for publishes that can't
   * break a link and that the editor didn't write, such as the site's
   * address or uploads, where warnings about the rest of the file would only
   * be in the way. With a draft open, the changes go into it; `draft` starts
   * one for them where none is.
   */
  publish(
    changes: FileChange[],
    message: string,
    options?: { checks?: boolean; draft?: boolean },
  ): Promise<PublishResult>;
  /** Unpublished changes kept to publish together. */
  drafts: DraftsValue;
  /** Reads one of the site's files at the loaded revision, or `undefined` if it doesn't exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Lists the site's files under a folder at the loaded revision. */
  listFiles(dir: string): Promise<string[]>;
  /** Reads one of the site's files as bytes at the loaded revision, or `undefined` if it doesn't exist. */
  readBytes(path: string): Promise<Uint8Array | undefined>;
  /**
   * The block registries the Blocks screen offers blocks from: Goodfellow's,
   * and, where installed code can't reach editors' tokens (`outOfReach`),
   * shadcn/ui's and those the config lists.
   */
  registries: RegistrySources;
  /**
   * Whether the site's own pages can't reach what the admin panel keeps: it
   * runs at the site's checked admin address, or on a development server,
   * which holds no tokens. Only then is code other than Goodfellow's installed.
   */
  outOfReach: boolean;
  /**
   * How plugins are installed here: published, where the admin panel runs at
   * the site's checked admin address or with a token broker, or submitted for
   * review, on a full-stack site. None elsewhere, where plugins are a
   * developer's to add.
   */
  pluginInstalls?: "publish" | "review";
  /** In a demo, the store keeping the visitor's changes in their browser. */
  demo?: DemoStore;
  /** The git host's own Pages, for connecting a domain, when the backend can. */
  pages?: PagesDomains;
  /** Earlier versions of the site's files, when the site is stored on a git host. */
  versions?: Pick<GitBackend, "history" | "readAt" | "filesAt">;
  /** The files that changed between two revisions, when the site is stored on a git host. */
  changedPaths?: (from: string, to: string) => Promise<string[]>;
  /** Who edits the site, when the backend can say. */
  editors?: SiteEditors;
  /** A second token for changing editors and Pages settings, where signing in can't. */
  ownerAccess?: OwnerAccess;
  /** The site's nightly update job, when the backend can run it. */
  updates?: SiteUpdates;
  /** The repository holds only the site's content: its code, and so its blocks, are a developer's to change. */
  contentOnly: boolean;
  /** How the site is built again when a scheduled change comes due, when the backend can say. */
  scheduledBuilds?: ScheduledBuilds;
  /** Who can read the site's repository, when the backend can say. */
  repositoryVisibility?: () => Promise<RepositoryVisibility>;
  /** Why the host wouldn't build the site at scheduled times, when the sign-in can't have it do so. */
  scheduleSyncProblem?: "not-allowed";
  /** Follows a build of the loaded revision that isn't a publish's, such as Rebuild now's, until it's live. */
  followBuild?(): void;
  /** Runs plugins' tasks in the site's CI, when the backend can. */
  tasks?: PluginTasks;
}

/** Whether the admin panel runs at the site's admin address, once it's checked (`AdminAddress.checked`). */
export function atAdminAddress(admin: AdminSite["admin"]): boolean {
  return admin?.checked === true && typeof location !== "undefined" && location.origin === adminOrigin(admin);
}

/** Provided by `AdminProvider`, and in the site's frames by a stand-in with only what their components use. */
export const AdminContext = createContext<AdminContextValue | null>(null);

/** How long a publish waits for the frame running the site's code before checking without it. */
const CODE_TIMEOUT = 20_000;

const DEPLOY_CHECK_INTERVAL = 5_000;
const DEPLOY_CHECK_LIMIT = 20 * 60_000;

async function load(store: ContentStore): Promise<LoadState> {
  try {
    // Read the revision first: reads then see that revision, even if someone publishes while loading.
    const revision = await store.revision();
    const [content, media] = await Promise.all([loadSiteContent(store), store.list(MEDIA_DIR)]);
    return { status: "ready", content, revision, media };
  } catch (error) {
    return { status: "error", error };
  }
}

function isGitBackend(store: ContentStore): store is GitBackend {
  return "deployStatus" in store && typeof store.deployStatus === "function";
}

/** Tells apart sites served from the same address, for what this browser keeps about each. */
function siteKey(siteUrl: string): string {
  return typeof location === "undefined" ? siteUrl : new URL(siteUrl, location.href).href;
}

export function AdminProvider({
  site,
  frames,
  store,
  account,
  preview,
  siteUrl,
  registry,
  onSignInError,
  children,
}: {
  site: AdminSite;
  /** Where the frames that run the site's code are loaded from. */
  frames: FrameSource;
  store: ContentStore;
  account?: Account;
  preview: PreviewOptions;
  siteUrl: string;
  /** Where Goodfellow's block registry is, as `https://…/{name}.json`. Defaults to its release on jsDelivr. */
  registry?: string;
  /** Called when the git host stops accepting the sign-in, such as when a token expires. */
  onSignInError?: (error: SignInError) => void;
  children: ReactNode;
}) {
  const t = useStrings();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deploy, setDeploy] = useState<DeployProgress>();
  // Drafts: the backend's own, on branches other editors see, or one kept in this browser.
  const key = siteKey(siteUrl);
  const backendDrafts = isGitBackend(store) ? store.drafts : undefined;
  const siteDrafts = useMemo<SiteDrafts>(
    () => backendDrafts ?? keptDrafts(store, browserDraftKeeper(key)),
    [backendDrafts, store, key],
  );
  const [draft, setDraft] = useState<Draft>();
  // Whether the draft this browser last worked in has been looked for, which loading the site waits for.
  const [draftFound, setDraftFound] = useState(false);
  const [draftNames, setDraftNames] = useState<string[]>([]);
  const [draftPaths, setDraftPaths] = useState<string[]>([]);
  // What screens read and publish to: the draft being worked in, or the live site.
  const content = draft?.store ?? store;
  // What the site checks found in the publish waiting for the editor's answer.
  const [checking, setChecking] = useState<{
    checks: PublishChecks;
    content: SiteContent;
    decide: (publish: boolean) => void;
  }>();
  const blocks = useMemo(
    () => describedConfig(site.description, "template").components as Record<string, ComponentConfig>,
    [site.description],
  );
  // Read when a preview shows a file, so stored media follows what's loaded.
  const storage = useRef<MediaStorage | undefined>(undefined);
  storage.current = state.status === "ready" ? state.content.mediaStorage : undefined;
  const mediaPreviews = useMemo(() => createMediaPreviews(content, siteUrl, () => storage.current), [content, siteUrl]);
  // The development servers give their own registry; their admin panel holds no tokens.
  // With a token broker, the admin panel holds no tokens, and the broker asks before publishing code.
  const outOfReach = registry !== undefined || atAdminAddress(site.admin) || site.broker !== undefined;
  const registries = useMemo(
    () => ({
      [GOODFELLOW_REGISTRY]: registry ?? goodfellowRegistryUrl(REGISTRY_VERSION),
      ...(outOfReach && { [SHADCN_NAMESPACE]: SHADCN_REGISTRY, ...site.registries }),
    }),
    [registry, site.registries, outOfReach],
  );
  // The hidden frame that runs the site's code, which publishes wait for, for a while.
  const codeFrame = useRef<{ client?: FrameClient; waiting: Array<(client: FrameClient) => void> }>({ waiting: [] });
  const onCodeClient = useCallback((client: FrameClient | undefined) => {
    codeFrame.current.client = client;
    if (client) for (const resolve of codeFrame.current.waiting.splice(0)) resolve(client);
  }, []);
  const code = useMemo(
    () =>
      frameSiteCode(() => {
        const { client, waiting } = codeFrame.current;
        if (client) return Promise.resolve(client);
        return new Promise<FrameClient>((resolve, reject) => {
          waiting.push(resolve);
          setTimeout(() => reject(new Error("The site's code didn't start.")), CODE_TIMEOUT);
        });
      }),
    [],
  );
  const favicon = state.status === "ready" ? state.content.settings.favicon : undefined;
  useEffect(() => (favicon ? showSiteIcon(document, favicon, mediaPreviews) : undefined), [favicon, mediaPreviews]);
  const readFile = useCallback((path: string) => content.read(path), [content]);
  const listFiles = useCallback((dir: string) => content.list(dir), [content]);
  const readBytes = useCallback((path: string) => content.readBytes(path), [content]);
  const demo = isDemoStore(store) ? store : undefined;
  const pages = isGitBackend(store) ? store.pages : undefined;
  const versions = isGitBackend(store) ? store : undefined;
  const changedPaths = useMemo(
    () => (isGitBackend(store) ? (from: string, to: string) => store.changedPaths(from, to) : undefined),
    [store],
  );
  const editors = isGitBackend(store) ? store.editors : undefined;
  const updates = isGitBackend(store) ? store.updates : undefined;
  const contentOnly = isGitBackend(store) && store.contentOnly === true;
  const scheduledBuilds = isGitBackend(store) ? store.scheduledBuilds : undefined;
  // Plugins' tasks go to the site's own backend, even while a draft is open.
  const tasks = "tasks" in store ? (store as { tasks?: PluginTasks }).tasks : undefined;
  const repositoryVisibility = useMemo(
    () => (isGitBackend(store) ? store.repositoryVisibility?.bind(store) : undefined),
    [store],
  );
  const [scheduleSyncProblem, setScheduleSyncProblem] = useState<"not-allowed">();
  // The backend's owner access, with whether it's in use as state, so every screen showing it updates together.
  const backendOwner = isGitBackend(store) ? store.ownerAccess : undefined;
  const [ownerActive, setOwnerActive] = useState(backendOwner?.active ?? false);
  const ownerAccess = useMemo<OwnerAccess | undefined>(
    () =>
      backendOwner && {
        tokenLink: backendOwner.tokenLink,
        active: ownerActive,
        problem: backendOwner.problem,
        ...(backendOwner.startRedirect && {
          startRedirect: (options) => backendOwner.startRedirect?.(options) ?? Promise.resolve(),
        }),
        async applyToken(token) {
          await backendOwner.applyToken(token);
          setOwnerActive(true);
        },
        forget() {
          backendOwner.forget();
          setOwnerActive(false);
        },
      },
    [backendOwner, ownerActive],
  );

  // A demo visitor's uploads aren't on the live site, and their replacements of its files would show the
  // live site's version, so previews show what the visitor saved instead.
  useEffect(() => {
    if (!demo) return;
    void demo.changes().then((changes) => {
      for (const change of changes) {
        if ("bytes" in change && change.path.startsWith(`${MEDIA_DIR}/`)) {
          mediaPreviews.remember(mediaUrl(change.path), change.bytes);
        }
      }
    });
  }, [demo, mediaPreviews]);

  // The store the shown site was last loaded from, so switching drafts loads it once, and a slower earlier load is ignored.
  const loadedFrom = useRef<ContentStore>(undefined);
  // Opening a draft or leaving one: screens start again once its content has loaded.
  const views = useRef(0);
  const loadFrom = useCallback(
    async (from: ContentStore) => {
      loadedFrom.current = from;
      const view = views.current;
      const next = await load(from);
      if (next.status === "error" && next.error instanceof SignInError) onSignInError?.(next.error);
      if (loadedFrom.current === from) setState(next.status === "ready" ? { ...next, view } : next);
    },
    [onSignInError],
  );

  const reload = useCallback(() => loadFrom(content), [loadFrom, content]);

  // The draft this browser was working in opens again, if it's still there.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const names = await siteDrafts.list().catch((): string[] => []);
      const remembered = rememberedDraft(key);
      const opened =
        remembered && names.includes(remembered) ? await siteDrafts.open(remembered).catch(() => undefined) : undefined;
      if (!opened) rememberDraft(key, undefined);
      if (cancelled) return;
      setDraftNames(names);
      setDraft(opened);
      setDraftFound(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [siteDrafts, key]);

  useEffect(() => {
    if (draftFound && loadedFrom.current !== content) void reload();
  }, [draftFound, content, reload]);

  const refreshDrafts = useCallback(
    async (current: Draft | undefined) => {
      const [names, paths] = await Promise.all([
        siteDrafts.list().catch((): string[] => []),
        current ? current.paths().catch((): string[] => []) : [],
      ]);
      setDraftNames(names);
      setDraftPaths(paths);
    },
    [siteDrafts],
  );
  useEffect(() => {
    if (draftFound) void refreshDrafts(draft);
  }, [draftFound, draft, refreshDrafts]);

  /** Shows the site checks' dialog where they found anything, and says whether to go ahead. */
  const confirmChecks = useCallback(async (checks: PublishChecks | undefined) => {
    if (!checks || (checks.blocking.length === 0 && checks.warnings.length === 0)) return true;
    const go = await new Promise<boolean>((decide) => setChecking({ checks, content: checks.content, decide }));
    setChecking(undefined);
    return go;
  }, []);

  const publish = useCallback(
    async (
      changes: FileChange[],
      message: string,
      options?: { checks?: boolean; draft?: boolean },
    ): Promise<PublishResult> => {
      if (state.status !== "ready") return { ok: false, reason: "error", error: new Error("The site isn't loaded.") };
      const checks =
        options?.checks === false ? undefined : await checkPublish(content, state, changes, { blocks, code });
      if (!(await confirmChecks(checks))) return { ok: false, reason: "checks", error: undefined };
      let target = draft;
      let started: Draft | undefined;
      let revision: string;
      try {
        let expectedRevision = state.revision;
        if (!target && options?.draft) {
          // From the revision the editor loaded, so publishing it fails where someone has changed the same files since.
          target = started = await siteDrafts.create(newDraftName(), { from: state.revision });
          expectedRevision = await started.store.revision();
        }
        ({ revision } = await writeChanges(target?.store ?? store, changes, { message, expectedRevision }));
      } catch (error) {
        if (started) await started.discard().catch(() => undefined);
        if (error instanceof SignInError && error.problem === "invalid") onSignInError?.(error);
        return { ok: false, reason: error instanceof ConflictError ? "conflict" : "error", error };
      }
      if (started) {
        rememberDraft(key, started.name);
        setDraft(started);
      } else if (target) void refreshDrafts(target);
      // A draft isn't built, so there's nothing to follow.
      else if (isGitBackend(store)) setDeploy({ revision, previous: state.revision, state: "building" });
      await loadFrom(target?.store ?? store);
      return { ok: true };
    },
    [
      store,
      content,
      draft,
      siteDrafts,
      key,
      state,
      blocks,
      code,
      confirmChecks,
      refreshDrafts,
      loadFrom,
      onSignInError,
    ],
  );

  const openDraft = useCallback(
    async (name: string | undefined) => {
      if (name === draft?.name) return true;
      let next: Draft | undefined;
      try {
        next = name ? await siteDrafts.open(name) : undefined;
      } catch (error) {
        if (!(error instanceof DraftError)) throw error;
        void refreshDrafts(draft);
        return false;
      }
      rememberDraft(key, name);
      views.current++;
      setDraft(next);
      return true;
    },
    [draft, siteDrafts, key, refreshDrafts],
  );

  const publishAll = useCallback(async (): Promise<PublishResult> => {
    if (!draft) return { ok: false, reason: "error", error: new Error("There's no draft open.") };
    let changes: FileChange[];
    let live: LoadState;
    try {
      [changes, live] = await Promise.all([draft.changes(), load(store)]);
    } catch (error) {
      return { ok: false, reason: "error", error };
    }
    if (live.status !== "ready") return { ok: false, reason: "error", error: live.status === "error" && live.error };
    // Every file in the draft, against the live site as it is now.
    if (!(await confirmChecks(await checkPublish(store, live, changes, { blocks, code })))) {
      return { ok: false, reason: "checks", error: undefined };
    }
    let revision: string;
    try {
      ({ revision } = await draft.publish(t("draft.message", { name: draft.name })));
    } catch (error) {
      if (error instanceof SignInError && error.problem === "invalid") onSignInError?.(error);
      return { ok: false, reason: error instanceof ConflictError ? "conflict" : "error", error };
    }
    rememberDraft(key, undefined);
    if (isGitBackend(store)) setDeploy({ revision, previous: live.revision, state: "building" });
    views.current++;
    setDraft(undefined);
    return { ok: true };
  }, [draft, store, blocks, code, key, t, confirmChecks, onSignInError]);

  const submitDraft = useCallback(async () => {
    if (!draft) return { ok: false as const, error: new Error("There's no draft open.") };
    try {
      const paths = await draft.paths();
      const { url } = await draft.submitForReview({
        title: t("draft.reviewTitle", { name: draft.name }),
        description: [t("draft.reviewDescription"), "", ...paths.map((path) => `- \`${path}\``)].join("\n"),
      });
      return { ok: true as const, url };
    } catch (error) {
      return { ok: false as const, error };
    }
  }, [draft, t]);

  const discardDraft = useCallback(async () => {
    if (!draft) return { ok: true as const };
    try {
      await draft.discard();
    } catch (error) {
      return { ok: false as const, error };
    }
    rememberDraft(key, undefined);
    views.current++;
    setDraft(undefined);
    return { ok: true as const };
  }, [draft, key]);

  const drafts = useMemo<DraftsValue>(
    () => ({
      kept: backendDrafts === undefined,
      names: draftNames,
      ...(draft && { current: { name: draft.name, paths: draftPaths } }),
      open: openDraft,
      publishAll,
      submit: submitDraft,
      discard: discardDraft,
    }),
    [backendDrafts, draftNames, draft, draftPaths, openDraft, publishAll, submitDraft, discardDraft],
  );

  // Where the host builds the site at each scheduled time (GitLab's pipeline schedules), keeps its builds in step
  // with the site's schedules: once the site loads, if anything is scheduled, then whenever they change.
  const syncedTimes = useRef<string>(undefined);
  useEffect(() => {
    const sync = scheduledBuilds?.sync?.bind(scheduledBuilds);
    if (!sync || state.status !== "ready") return;
    const times = [...new Set(upcomingChanges(state.content).map((change) => change.at.getTime()))];
    const key = times.join(" ");
    if (key === syncedTimes.current || (syncedTimes.current === undefined && times.length === 0)) return;
    syncedTimes.current = key;
    void sync(times.map((time) => new Date(time))).then(
      () => setScheduleSyncProblem(undefined),
      (error: unknown) => {
        // Changes still go live with the next nightly build; screens say so.
        if (error instanceof ScheduledBuildsError) setScheduleSyncProblem(error.problem);
        // Another time, such as when the network is back.
        else syncedTimes.current = undefined;
      },
    );
  }, [scheduledBuilds, state]);

  // Follows the latest publish until it's live (or fails), so editors know when visitors will see it.
  useEffect(() => {
    if (deploy?.state !== "building" || !isGitBackend(store)) return;
    const started = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const status = await store.deployStatus(deploy.revision).catch((): DeployStatus => ({ state: "unknown" }));
      if (cancelled) return;
      if (status.state === "building" && Date.now() - started < DEPLOY_CHECK_LIMIT) {
        timer = setTimeout(check, DEPLOY_CHECK_INTERVAL);
      } else {
        setDeploy({ revision: deploy.revision, previous: deploy.previous, ...status });
      }
    };
    timer = setTimeout(check, DEPLOY_CHECK_INTERVAL);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deploy, store]);

  const followBuild = useCallback(() => {
    if (state.status === "ready" && isGitBackend(store)) {
      setDeploy({ revision: state.revision, previous: state.revision, state: "building" });
    }
  }, [state, store]);

  // Plugins' code runs when the site builds: installed only where the site's own pages can't publish it.
  const pluginInstalls =
    demo || contentOnly
      ? undefined
      : account?.review
        ? ("review" as const)
        : atAdminAddress(site.admin) || site.broker !== undefined
          ? ("publish" as const)
          : undefined;

  const value = useMemo(
    () => ({
      site,
      blocks,
      code,
      preview,
      siteUrl,
      state,
      account,
      deploy,
      mediaPreviews,
      reload,
      publish,
      drafts,
      readFile,
      listFiles,
      readBytes,
      registries,
      outOfReach,
      pluginInstalls,
      demo,
      pages,
      versions,
      changedPaths,
      editors,
      ownerAccess,
      updates,
      contentOnly,
      scheduledBuilds,
      repositoryVisibility,
      scheduleSyncProblem,
      followBuild,
      tasks,
    }),
    [
      site,
      blocks,
      code,
      preview,
      siteUrl,
      state,
      account,
      deploy,
      mediaPreviews,
      reload,
      publish,
      drafts,
      readFile,
      listFiles,
      readBytes,
      registries,
      outOfReach,
      pluginInstalls,
      demo,
      pages,
      versions,
      changedPaths,
      editors,
      ownerAccess,
      updates,
      contentOnly,
      scheduledBuilds,
      repositoryVisibility,
      scheduleSyncProblem,
      followBuild,
      tasks,
    ],
  );

  // With a draft open, every screen's Publish adds to it.
  const table = useStringTable();
  const strings = useMemo(
    () =>
      draft
        ? {
            ...table,
            "publish.button": table["draft.add"],
            "publish.publishing": table["draft.adding"],
            "publish.done": table["draft.added"],
          }
        : table,
    [draft, table],
  );
  return (
    <AdminContext.Provider value={value}>
      <StringsProvider strings={strings}>
        {state.status === "ready" ? (
          <SiteFrames frames={frames} state={state} onCodeClient={onCodeClient}>
            {children}
          </SiteFrames>
        ) : (
          children
        )}
        {checking && <ChecksDialog checks={checking.checks} content={checking.content} onDecide={checking.decide} />}
      </StringsProvider>
    </AdminContext.Provider>
  );
}

/** The site's compiled CSS as text, read once, for the editor's frame, which can't read anything itself. */
function useSiteCss(stylesheets: string[]): () => Promise<string[]> {
  const key = stylesheets.join("\n");
  return useMemo(() => {
    let found: Promise<string[]> | undefined;
    return () => {
      found ??= Promise.all(
        key
          .split("\n")
          .filter(Boolean)
          .map((href) =>
            fetch(href)
              .then((response) => (response.ok ? response.text() : ""))
              .catch(() => ""),
          ),
      );
      return found;
    };
  }, [key]);
}

/**
 * What the site's frames are told and can ask for, once the site has loaded,
 * and the hidden frame that runs the site's code for the screens.
 */
function SiteFrames({
  frames,
  state,
  onCodeClient,
  children,
}: {
  frames: FrameSource;
  state: Extract<LoadState, { status: "ready" }>;
  onCodeClient: (client: FrameClient | undefined) => void;
  children: ReactNode;
}) {
  const t = useStrings();
  const strings = useStringTable();
  const theme = useThemeChoice();
  const {
    site,
    preview,
    siteUrl,
    mediaPreviews,
    account,
    scheduledBuilds,
    repositoryVisibility,
    scheduleSyncProblem,
    readFile,
    readBytes,
    listFiles,
    publish,
    tasks,
  } = useAdmin();
  const { timing, visibility } = useScheduleInfoOf(scheduledBuilds, repositoryVisibility);
  const schedule = useMemo(
    () => ({
      ...(timing && { timing }),
      ...(visibility && { visibility }),
      ...(scheduleSyncProblem && { syncProblem: scheduleSyncProblem }),
    }),
    [timing, visibility, scheduleSyncProblem],
  );
  const siteCss = useSiteCss(preview.stylesheets);
  const [choosing, setChoosing] = useState<{ kind: MediaFieldKind; resolve: (url: string | null) => void }>();
  const confirmLeave = t("unsaved.confirm");
  // Plugins' frames: each answered only for what its plugin declared (`plugin-frames.tsx`).
  const plugins = useMemo(() => site.description.plugins ?? [], [site.description.plugins]);
  const pluginHost = useMemo<PluginHost>(
    () => ({
      editorUrl: frames.url,
      siteUrl,
      theme,
      read: readFile,
      readBytes,
      list: listFiles,
      publish: async (changes, message) => (await publish(changes, message)).ok,
      ...(account?.plugins && { server: account.plugins }),
      navigate: (href) => navigate(href, () => window.confirm(confirmLeave)),
      secretsHelp: async (plugin) => pluginSecretsHelp(await tasks?.secretsPlace().catch(() => undefined), plugin, t),
      ...(tasks && {
        runTask: async (request: PluginTaskRequest) => {
          try {
            return await tasks.run(request);
          } catch (error) {
            if (error instanceof PluginTaskError) throw new Error(t(`plugins.task.${error.problem}`));
            throw error;
          }
        },
      }),
    }),
    [frames.url, siteUrl, theme, readFile, readBytes, listFiles, publish, account, confirmLeave, tasks, t],
  );
  const callPlugin = useRef<(plugin: string, method: string, args: unknown[]) => Promise<unknown>>(undefined);
  const onPluginCall = useCallback((call: (plugin: string, method: string, args: unknown[]) => Promise<unknown>) => {
    callPlugin.current = call;
  }, []);
  const services = useMemo<FrameServices>(
    () => ({
      source: frames,
      init: {
        content: state.content,
        media: allMedia(state.content, state.media),
        schedule,
        siteUrl,
        preview,
        strings,
        theme,
        hostName: account?.hostName ?? "",
      },
      siteCss,
      mediaPreviews,
      chooseMedia: (kind) =>
        new Promise((resolve) => {
          setChoosing((current) => {
            current?.resolve(null);
            return { kind, resolve };
          });
        }),
      navigate: (href) => navigate(href, () => window.confirm(confirmLeave)),
      callPlugin: (plugin, method, args) =>
        callPlugin.current
          ? callPlugin.current(plugin, method, args)
          : Promise.reject(new Error("Plugins haven't started.")),
    }),
    [frames, state, schedule, siteUrl, preview, strings, theme, account, siteCss, mediaPreviews, confirmLeave],
  );
  return (
    <FrameServicesProvider value={services}>
      <PluginServices plugins={plugins} host={pluginHost} onCall={onPluginCall}>
        {children}
      </PluginServices>
      <SiteCodeFrame onClient={onCodeClient} />
      {choosing && (
        <MediaPickerDialog
          kind={choosing.kind}
          onSelect={(url) => {
            choosing.resolve(url);
            setChoosing(undefined);
          }}
          onClose={() => {
            choosing.resolve(null);
            setChoosing(undefined);
          }}
        />
      )}
    </FrameServicesProvider>
  );
}

/** Whether the signed-in person may change Site Settings, blocks, and collections' settings and templates. */
export function useCanChangeSettings(): boolean {
  return useAdmin().account?.role !== "editor";
}

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin() must be used inside <Admin>.");
  return value;
}

/** The loaded site. Only call from screens rendered once loading has finished. */
export function useSiteContent(): { content: SiteContent; revision: string; media: string[] } {
  const { state } = useAdmin();
  if (state.status !== "ready") throw new Error("The site isn't loaded yet.");
  return state;
}
