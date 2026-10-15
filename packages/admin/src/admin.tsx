import {
  COLLECTIONS_DIR,
  ContentError,
  type ContentStore,
  FOOTER_FILE,
  type GitHost,
  type GoodfellowConfig,
  HEADER_FILE,
} from "@goodfellow-cms/core";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminProvider, type PreviewOptions, useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import { forgetAiKeys } from "./ai-settings.js";
import { AppSignInGate } from "./app-sign-in.js";
import { BlocksScreen } from "./blocks-screen.js";
import { BuildProblemButton } from "./build-problem.js";
import { EntriesScreen, TemplateScreen } from "./collection-screen.js";
import { CollectionSettingsScreen } from "./collection-settings.js";
import { CollectionsScreen } from "./collections-screen.js";
import { createDemoStore } from "./demo.js";
import { DomainScreen } from "./domain-screen.js";
import { LayoutEditorScreen, PageEditorScreen } from "./editor-screens.js";
import { EditorsScreen } from "./editors-screen.js";
import { EntryEditorScreen } from "./entry-editor.js";
import { MediaScreen } from "./media-library.js";
import { PagesScreen } from "./pages-screen.js";
import { SETTINGS_SECTIONS, useRoute } from "./router.js";
import { SETTINGS_TABS, SettingsScreen, type SettingsTab } from "./settings-screen.js";
import { SignInGate } from "./sign-in.js";
import { isPreviewAddress, SitePreview } from "./site-preview.js";
import { defaultStrings, type Strings, StringsProvider, useStrings } from "./strings.js";
import { setThemeChoice, type ThemeChoice, useApplyThemeChoice, useThemeChoice } from "./theme.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";
import { UpdatesScreen } from "./updates-screen.js";
import { AppLink } from "./use-link.js";
import { VersionsScreen } from "./versions-screen.js";

export interface AdminProps {
  /** The site's `goodfellow.config.tsx`. */
  config: GoodfellowConfig;
  /**
   * Where the site's files are read from and published to, without signing in.
   * Used by `goodfellow dev`. Otherwise the admin panel signs in to `host`. In a
   * demo (the config's `demo`), it's only read from, and changes stay in the browser.
   */
  store?: ContentStore;
  /** The git host the site is stored on. Defaults to the config's `backend`. */
  host?: GitHost;
  /**
   * The address of a full-stack site's API for the admin panel, such as
   * `/api/goodfellow`. Editors then sign in with the site's own sign-in, and its
   * server reads and publishes for them, so they never sign in to the git host.
   */
  server?: string;
  preview: PreviewOptions;
  /** The live site's address, for "View" links. Defaults to `/`. */
  siteUrl?: string;
  /** Replaces any of the admin panel's text, for rewording or translation. */
  strings?: Partial<Strings>;
  /**
   * Where Goodfellow's block registry is, as `https://…/{name}.json`. Defaults to the
   * release this admin panel was built with; the development servers serve their own copy.
   */
  registry?: string;
}

function LoadError({ error }: { error: unknown }) {
  const t = useStrings();
  const { reload } = useAdmin();
  const details =
    error instanceof ContentError ? new Error(error.problems.map((p) => `${p.file}: ${p.message}`).join("\n")) : error;
  return (
    <div className="gfa-screen">
      <h1>{t("loadError.title")}</h1>
      <ErrorMessage
        message={t(error instanceof ContentError ? "loadError.contentProblems" : "loadError.other")}
        error={details}
        action={<Button onClick={() => void reload()}>{t("action.tryAgain")}</Button>}
      />
    </div>
  );
}

/** Shown in place of screens only owners use, where the site's own sign-in says someone is an editor. */
function OwnersOnly() {
  const t = useStrings();
  return (
    <div className="gfa-screen">
      <h1>{t("owners.only")}</h1>
      <p className="gfa-hint">{t("owners.onlyHint")}</p>
    </div>
  );
}

function CollectionRoute({ id, sub, slug }: { id: string; sub?: string; slug: string }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const owner = useCanChangeSettings();
  if (sub === "edit") return <EntryEditorScreen collectionId={id} slug={slug} />;
  const collection = content.collections.find((candidate) => candidate.id === id);
  if (!collection) {
    return (
      <div className="gfa-screen">
        <p>{t("collection.notFound")}</p>
        <AppLink href="#/collections">{t("collection.back")}</AppLink>
      </div>
    );
  }
  if ((sub === "template" || sub === "settings") && !owner) return <OwnersOnly />;
  if (sub === "template") return <TemplateScreen collection={collection} />;
  if (sub === "settings") return <CollectionSettingsScreen key={collection.id} collection={collection} />;
  return <EntriesScreen collection={collection} />;
}

function Screen() {
  const { segments, params } = useRoute();
  const [section, sub, tab] = segments;
  const owner = useCanChangeSettings();

  if ((section === "blocks" || section === "settings") && !owner) return <OwnersOnly />;
  if (section === "media") return <MediaScreen />;
  if (section === "blocks") return <BlocksScreen />;
  if (section === "collections") {
    return sub ? <CollectionRoute id={sub} sub={tab} slug={params.get("slug") ?? ""} /> : <CollectionsScreen />;
  }

  if (section === "pages" && sub === "edit") return <PageEditorScreen path={params.get("path") ?? "/"} />;
  if (section === "layout") return <LayoutEditorScreen part={sub === "footer" ? "footer" : "header"} />;
  if (section === "settings" && sub === "domain") return <DomainScreen />;
  if (section === "settings" && sub === "editors") return <EditorsScreen />;
  if (section === "settings" && sub === "updates") return <UpdatesScreen />;
  if (section === "versions") return <VersionsScreen file={params.get("file") ?? ""} />;
  if (section === "settings") {
    const tab = SETTINGS_TABS.includes(sub as SettingsTab) ? (sub as SettingsTab) : "general";
    const section = Object.values(SETTINGS_SECTIONS).find((name) => name === params.get("section"));
    return <SettingsScreen tab={tab} section={section} />;
  }
  return <PagesScreen />;
}

function DeployIndicator() {
  const t = useStrings();
  const { deploy } = useAdmin();
  if (!deploy || deploy.state === "unknown") return null;
  return (
    <span className={`gfa-deploy gfa-deploy-${deploy.state}`} role="status">
      {t(deploy.state === "building" ? "deploy.building" : deploy.state === "live" ? "deploy.live" : "deploy.failed")}
      {deploy.state === "failed" && (
        <>
          {" "}
          <BuildProblemButton />
        </>
      )}
    </span>
  );
}

/** Says the admin panel is a demo, and lets the visitor undo everything they've changed. */
function DemoBanner() {
  const t = useStrings();
  const { demo } = useAdmin();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!demo) return null;
  const startOver = async () => {
    setBusy(true);
    await demo.reset();
    // Every screen starts again from the site's content, including forms that copied what they loaded.
    location.reload();
  };
  return (
    <div className="gfa-demo-banner" role="note">
      <span>{t("demo.banner")}</span>
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        {t("demo.startOver")}
      </Button>
      {confirming && (
        <Dialog title={t("demo.startOverTitle")} onClose={() => setConfirming(false)}>
          <p>{t("demo.startOverBody")}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void startOver()}>
              {t("demo.startOver")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AccountMenu() {
  const t = useStrings();
  const { account } = useAdmin();
  if (!account) return null;
  const { user } = account;
  return (
    <div className="gfa-account">
      {user.avatarUrl && <img src={user.avatarUrl} alt="" width={24} height={24} />}
      <span title={t("account.signedInAs", { name: user.login })}>{user.name || user.login}</span>
      {account.signOut && (
        <Button variant="ghost" onClick={account.signOut}>
          {t("account.signOut")}
        </Button>
      )}
    </div>
  );
}

/** Light, dark, or the computer's setting, remembered in this browser. */
function ThemeMenu() {
  const t = useStrings();
  const choice = useThemeChoice();
  return (
    <select
      className="gfa-theme-menu"
      aria-label={t("appearance.choice")}
      value={choice}
      onChange={(event) => setThemeChoice(event.target.value as ThemeChoice)}
    >
      <option value="system">{t("appearance.system")}</option>
      <option value="light">{t("appearance.light")}</option>
      <option value="dark">{t("appearance.dark")}</option>
    </select>
  );
}

/** The part of the admin panel a file's Version history belongs to. */
function versionsSection(file: string): "pages" | "collections" | "layout" {
  if (file.startsWith(`${COLLECTIONS_DIR}/`)) return "collections";
  return file === HEADER_FILE || file === FOOTER_FILE ? "layout" : "pages";
}

function Shell() {
  const t = useStrings();
  const { state, siteUrl } = useAdmin();
  const owner = useCanChangeSettings();
  const { segments, params } = useRoute();
  const [section] = segments;
  const current =
    section === "versions"
      ? versionsSection(params.get("file") ?? "")
      : section === "layout" ||
          section === "settings" ||
          section === "collections" ||
          section === "media" ||
          section === "blocks"
        ? section
        : "pages";

  return (
    <div className="gfa-app">
      <header className="gfa-topbar">
        <span className="gfa-brand">{state.status === "ready" ? state.content.settings.title : t("app.title")}</span>
        <nav className="gfa-nav" aria-label={t("app.title")}>
          <AppLink href="#/pages" aria-current={current === "pages" ? "page" : undefined}>
            {t("nav.pages")}
          </AppLink>
          <AppLink href="#/collections" aria-current={current === "collections" ? "page" : undefined}>
            {t("nav.collections")}
          </AppLink>
          <AppLink href="#/media" aria-current={current === "media" ? "page" : undefined}>
            {t("nav.media")}
          </AppLink>
          <AppLink href="#/layout/header" aria-current={current === "layout" ? "page" : undefined}>
            {t("nav.layout")}
          </AppLink>
          {owner && (
            <AppLink href="#/blocks" aria-current={current === "blocks" ? "page" : undefined}>
              {t("nav.blocks")}
            </AppLink>
          )}
          {owner && (
            <AppLink href="#/settings/general" aria-current={current === "settings" ? "page" : undefined}>
              {t("nav.settings")}
            </AppLink>
          )}
        </nav>
        <DeployIndicator />
        <a className="gfa-topbar-link" href={siteUrl} target="_blank" rel="noreferrer">
          {t("app.viewSite")}
        </a>
        <ThemeMenu />
        <AccountMenu />
      </header>
      <DemoBanner />
      <main className="gfa-content">
        {state.status === "loading" && <p className="gfa-screen">{t("loading")}</p>}
        {state.status === "error" && <LoadError error={state.error} />}
        {state.status === "ready" && <Screen />}
      </main>
    </div>
  );
}

function MissingBackend() {
  const t = useStrings();
  return (
    <div className="gfa-screen">
      <ErrorMessage message={t("setup.noBackend")} />
    </div>
  );
}

/** The admin panel. Render it on its own page, such as `/admin`. */
export function Admin({
  config,
  store,
  host = config.backend,
  server,
  preview,
  siteUrl = "/",
  strings,
  registry,
}: AdminProps) {
  // Light or dark everywhere, signing in included.
  useApplyThemeChoice();
  const demo = useMemo(
    () => (config.demo ? createDemoStore(siteUrl, store) : undefined),
    [config.demo, siteUrl, store],
  );
  // In a demo, "Published." would mislead: the changes are only saved in the browser.
  const text = useMemo(
    () =>
      demo ? { ...strings, "publish.done": strings?.["demo.published"] ?? defaultStrings["demo.published"] } : strings,
    [demo, strings],
  );
  // The page tools such as the Claude connector take screenshots of drafts with; it signs nobody in.
  if (typeof location !== "undefined" && isPreviewAddress(location.hash)) {
    return <SitePreview config={config} preview={preview} />;
  }
  const body = demo ? (
    <AdminProvider config={config} store={demo} preview={preview} siteUrl={siteUrl} registry={registry}>
      <Shell />
    </AdminProvider>
  ) : store ? (
    <AdminProvider config={config} store={store} preview={preview} siteUrl={siteUrl} registry={registry}>
      <Shell />
    </AdminProvider>
  ) : server ? (
    <AppSignInGate api={server}>
      {(backend, session, signOut) => (
        <AdminProvider
          config={config}
          store={backend}
          account={{
            user: backend.user,
            hostName: host?.name ?? "",
            redirectAddressesListed: false,
            role: session.role,
            ...(session.ai.length > 0 && {
              ai: { server: new URL(`${server.replace(/\/+$/, "")}/ai`, location.href).href, services: session.ai },
            }),
            ...(session.signOut && {
              signOut: () => {
                forgetAiKeys();
                signOut();
              },
            }),
          }}
          preview={preview}
          siteUrl={siteUrl}
          registry={registry}
          onSignInError={(error) => signOut(error)}
        >
          <Shell />
        </AdminProvider>
      )}
    </AppSignInGate>
  ) : host ? (
    <SignInGate host={host}>
      {(backend, signOut) => (
        <AdminProvider
          config={config}
          store={backend}
          account={{
            user: backend.user,
            hostName: host.name,
            redirectAddressesListed: host.canRedirect && host.redirectAddressesListed === true,
            signOut: () => {
              // Signing out also forgets AI keys, so the next person on this computer can't use them.
              forgetAiKeys();
              signOut();
            },
          }}
          preview={preview}
          siteUrl={siteUrl}
          registry={registry}
          onSignInError={(error) => signOut(error)}
        >
          <Shell />
        </AdminProvider>
      )}
    </SignInGate>
  ) : (
    <MissingBackend />
  );
  return <StringsProvider strings={text}>{body}</StringsProvider>;
}

/** Renders the admin panel into an element. */
export function mountAdmin(element: Element, props: AdminProps): void {
  createRoot(element).render(<Admin {...props} />);
}
