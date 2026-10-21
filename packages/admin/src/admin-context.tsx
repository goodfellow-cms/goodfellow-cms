import {
  type AppRole,
  ConflictError,
  type ContentStore,
  type DemoStore,
  type DeployStatus,
  type FileChange,
  type GitBackend,
  type GitUser,
  GOODFELLOW_REGISTRY,
  type GoodfellowConfig,
  goodfellowRegistryUrl,
  isDemoStore,
  loadSiteContent,
  MEDIA_DIR,
  type OwnerAccess,
  type PagesDomains,
  type RegistrySources,
  SignInError,
  type SiteContent,
  type SiteEditors,
  type SiteUpdates,
  writeChanges,
} from "@goodfellow-cms/core";
import { createPuckConfig } from "@goodfellow-cms/react";
import type { Config } from "@puckeditor/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ChecksDialog } from "./checks-dialog.js";
import { mediaUrl } from "./media.js";
import { createMediaPreviews, type MediaPreviews } from "./media-previews.js";
import { REGISTRY_VERSION } from "./registry-version.js";
import { checkPublish, type PublishChecks } from "./site-checks.js";
import { showSiteIcon } from "./site-icon.js";

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

interface AdminContextValue {
  config: GoodfellowConfig;
  pageConfig: Config;
  layoutConfig: Config;
  templateConfig: Config;
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
  /** The block registries the Blocks screen offers blocks from: Goodfellow's, and those the config lists. */
  registries: RegistrySources;
  /** In a demo, the store keeping the visitor's changes in their browser. */
  demo?: DemoStore;
  /** The git host's own Pages, for connecting a domain, when the backend can. */
  pages?: PagesDomains;
  /** Earlier versions of the site's files, when the site is stored on a git host. */
  versions?: Pick<GitBackend, "history" | "readAt">;
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
}

const AdminContext = createContext<AdminContextValue | null>(null);

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
  config,
  store,
  account,
  preview,
  siteUrl,
  registry,
  onSignInError,
  children,
}: {
  config: GoodfellowConfig;
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
  const pageConfig = useMemo(() => createPuckConfig(config, "page"), [config]);
  const layoutConfig = useMemo(() => createPuckConfig(config, "layout"), [config]);
  const templateConfig = useMemo(() => createPuckConfig(config, "template"), [config]);
  const mediaPreviews = useMemo(() => createMediaPreviews(store, siteUrl), [store, siteUrl]);
  const registries = useMemo(
    () => ({ [GOODFELLOW_REGISTRY]: registry ?? goodfellowRegistryUrl(REGISTRY_VERSION), ...config.registries }),
    [registry, config.registries],
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
      const checks = options?.checks === false ? undefined : await checkPublish(store, state, changes, config);
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
    [store, state, config, loadAndHandle, onSignInError],
  );

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
      config,
      pageConfig,
      layoutConfig,
      templateConfig,
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
      demo,
      pages,
      versions,
      changedPaths,
      editors,
      ownerAccess,
      updates,
      contentOnly,
    }),
    [
      config,
      pageConfig,
      layoutConfig,
      templateConfig,
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
      demo,
      pages,
      versions,
      changedPaths,
      editors,
      ownerAccess,
      updates,
      contentOnly,
    ],
  );

  return (
    <AdminContext.Provider value={value}>
      {children}
      {checking && <ChecksDialog checks={checking.checks} content={checking.content} onDecide={checking.decide} />}
    </AdminContext.Provider>
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
