import {
  type AdminSite,
  type AppRole,
  adminOrigin,
  ConflictError,
  type ContentStore,
  type DemoStore,
  type DeployStatus,
  describedConfig,
  type FileChange,
  type GitBackend,
  type GitUser,
  GOODFELLOW_REGISTRY,
  goodfellowRegistryUrl,
  isDemoStore,
  loadSiteContent,
  MEDIA_DIR,
  type OwnerAccess,
  type PagesDomains,
  type RegistrySources,
  type RepositoryVisibility,
  type ScheduledBuilds,
  ScheduledBuildsError,
  SHADCN_NAMESPACE,
  SHADCN_REGISTRY,
  SignInError,
  type SiteContent,
  type SiteEditors,
  type SiteUpdates,
  upcomingChanges,
  writeChanges,
} from "@goodfellow-cms/core";
import type { MediaFieldKind } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChecksDialog } from "./checks-dialog.js";
import {
  type FrameClient,
  type FrameServices,
  FrameServicesProvider,
  type FrameSource,
  frameSiteCode,
  SiteCodeFrame,
} from "./frame/host.js";
import { mediaUrl } from "./media.js";
import { MediaPickerDialog } from "./media-library.js";
import { createMediaPreviews, type MediaPreviews } from "./media-previews.js";
import { REGISTRY_VERSION } from "./registry-version.js";
import { navigate } from "./router.js";
import { useScheduleInfoOf } from "./schedule.js";
import { checkPublish, type PublishChecks } from "./site-checks.js";
import type { SiteCodeService } from "./site-code.js";
import { showSiteIcon } from "./site-icon.js";
import { useStrings, useStringTable } from "./strings.js";
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
  | { status: "ready"; content: SiteContent; revision: string; media: string[] };

/**
 * How a publish went. `checks` means the site checks stopped it, or the editor
 * went back to fix what they found: their dialog has said why, so screens say
 * nothing more.
 */
export type PublishResult = { ok: true } | { ok: false; reason: "conflict" | "error" | "checks"; error: unknown };

/** Whether the latest publish has reached the live site. `previous` is the revision before it. */
export type DeployProgress = { revision: string; previous?: string } & DeployStatus;

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
  /** On a full-stack site, the AI services its server asks with keys of its own, at `server`. */
  ai?: { server: string; services: string[] };
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
   * be in the way.
   */
  publish(changes: FileChange[], message: string, options?: { checks?: boolean }): Promise<PublishResult>;
  /** Reads one of the site's files at the loaded revision, or `undefined` if it doesn't exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Lists the site's files under a folder at the loaded revision. */
  listFiles(dir: string): Promise<string[]>;
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
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [deploy, setDeploy] = useState<DeployProgress>();
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
  const mediaPreviews = useMemo(() => createMediaPreviews(store, siteUrl), [store, siteUrl]);
  // The development servers give their own registry; their admin panel holds no tokens.
  const outOfReach = registry !== undefined || atAdminAddress(site.admin);
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
  const readFile = useCallback((path: string) => store.read(path), [store]);
  const listFiles = useCallback((dir: string) => store.list(dir), [store]);
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

  const loadAndHandle = useCallback(async () => {
    const next = await load(store);
    if (next.status === "error" && next.error instanceof SignInError) onSignInError?.(next.error);
    return next;
  }, [store, onSignInError]);

  const reload = useCallback(async () => {
    setState(await loadAndHandle());
  }, [loadAndHandle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publish = useCallback(
    async (changes: FileChange[], message: string, options?: { checks?: boolean }): Promise<PublishResult> => {
      if (state.status !== "ready") return { ok: false, reason: "error", error: new Error("The site isn't loaded.") };
      const checks =
        options?.checks === false ? undefined : await checkPublish(store, state, changes, { blocks, code });
      if (checks && (checks.blocking.length > 0 || checks.warnings.length > 0)) {
        const go = await new Promise<boolean>((decide) => setChecking({ checks, content: checks.content, decide }));
        setChecking(undefined);
        if (!go) return { ok: false, reason: "checks", error: undefined };
      }
      let revision: string;
      try {
        ({ revision } = await writeChanges(store, changes, { message, expectedRevision: state.revision }));
      } catch (error) {
        if (error instanceof SignInError && error.problem === "invalid") onSignInError?.(error);
        return { ok: false, reason: error instanceof ConflictError ? "conflict" : "error", error };
      }
      if (isGitBackend(store)) setDeploy({ revision, previous: state.revision, state: "building" });
      setState(await loadAndHandle());
      return { ok: true };
    },
    [store, state, blocks, code, loadAndHandle, onSignInError],
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
      readFile,
      listFiles,
      registries,
      outOfReach,
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
      readFile,
      listFiles,
      registries,
      outOfReach,
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
    ],
  );

  return (
    <AdminContext.Provider value={value}>
      {state.status === "ready" ? (
        <SiteFrames frames={frames} state={state} onCodeClient={onCodeClient}>
          {children}
        </SiteFrames>
      ) : (
        children
      )}
      {checking && <ChecksDialog checks={checking.checks} content={checking.content} onDecide={checking.decide} />}
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
  const { preview, siteUrl, mediaPreviews, account, scheduledBuilds, repositoryVisibility, scheduleSyncProblem } =
    useAdmin();
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
  const services = useMemo<FrameServices>(
    () => ({
      source: frames,
      init: {
        content: state.content,
        media: state.media,
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
    }),
    [frames, state, schedule, siteUrl, preview, strings, theme, account, siteCss, mediaPreviews, confirmLeave],
  );
  return (
    <FrameServicesProvider value={services}>
      {children}
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
