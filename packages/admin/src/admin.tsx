import {
  type AdminSite,
  BROKER_AI_ADDRESS,
  COLLECTIONS_DIR,
  ContentError,
  type ContentStore,
  FOOTER_FILE,
  type GitHost,
  HEADER_FILE,
} from "@goodfellow-cms/core";
import { Menu as MenuIcon, Moon, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminProvider, type PreviewOptions, useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import {
  ADMIN_LANGUAGES,
  isAdminLanguage,
  setAdminLanguage,
  useAdminLanguage,
  useAdminText,
} from "./admin-language.js";
import { forgetAiKeys } from "./ai-settings.js";
import { appServer } from "./app-server.js";
import { AppSignInGate } from "./app-sign-in.js";
import { BlocksScreen } from "./blocks-screen.js";
import { BrokerGate } from "./broker-gate.js";
import { BuildProblemButton } from "./build-problem.js";
import { EntriesScreen, TemplateScreen } from "./collection-screen.js";
import { CollectionSettingsScreen } from "./collection-settings.js";
import { CollectionsScreen } from "./collections-screen.js";
import { CommentsScreen } from "./comments-screen.js";
import { createDemoStore } from "./demo.js";
import { DomainScreen } from "./domain-screen.js";
import { draftStarted } from "./drafts.js";
import { LayoutEditorScreen, PageEditorScreen } from "./editor-screens.js";
import { EditorTextContext } from "./editor-text.js";
import { EditorsScreen } from "./editors-screen.js";
import { EntryEditorScreen } from "./entry-editor.js";
import type { FrameSource } from "./frame/host.js";
import { ImportScreen } from "./import-screen.js";
import { MediaScreen } from "./media-library.js";
import { PagesScreen } from "./pages-screen.js";
import { PluginScreenFrame } from "./plugin-frames.js";
import { PluginsScreen } from "./plugins-screen.js";
import { hasUnsavedChanges, SETTINGS_SECTIONS, useRoute } from "./router.js";
import { SecurityScreen } from "./security-screen.js";
import { SETTINGS_TABS, SettingsScreen, type SettingsTab } from "./settings-screen.js";
import { type SettingsPlace, SettingsSidebar } from "./settings-sidebar.js";
import { SignInGate } from "./sign-in.js";
import { SiteHistoryScreen } from "./site-history-screen.js";
import { isPreviewAddress, SitePreview } from "./site-preview.js";
import { defaultStrings, type StringKey, type Strings, StringsProvider, useStrings } from "./strings.js";
import { setDarkMode, useApplyThemeChoice, useDarkMode } from "./theme.js";
import { ThemesScreen } from "./themes-screen.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";
import { UpdatesScreen } from "./updates-screen.js";
import { AppLink } from "./use-link.js";
import { VersionsScreen } from "./versions-screen.js";

export interface AdminProps {
  /**
   * What the admin panel knows about the site, made from its config where the
   * config is loaded (`adminSite()` in `@goodfellow-cms/react`): the admin
   * panel's own page never loads the config, whose blocks run in sandboxed frames.
   */
  site: AdminSite;
  /** Where those frames are loaded from. */
  frames: FrameSource;
  /**
   * Where the site's files are read from and published to, without signing in.
   * Used by `goodfellow dev`. Otherwise the admin panel signs in to `host`. In a
   * demo (the config's `demo`), it's only read from, and changes stay in the browser.
   */
  store?: ContentStore;
  /** The git host the site is stored on, made from `site.backend`. */
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

/** Shown in place of the Blocks screen where the site's code is kept in a repository of its own. */
function BlocksInCode() {
  const t = useStrings();
  return (
    <div className="gfa-screen">
      <h1>{t("blocks.contentOnly")}</h1>
      <p className="gfa-hint">{t("blocks.contentOnlyHint")}</p>
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

/** One of a plugin's screens, which its admin module draws in a frame of its own. */
function PluginScreen({ id, screen }: { id?: string; screen?: string }) {
  const t = useStrings();
  const { site } = useAdmin();
  const plugin = site.description.plugins?.find((candidate) => candidate.id === id);
  const found = plugin?.screens?.find((candidate) => candidate.id === screen);
  if (!plugin || !found) {
    return (
      <div className="gfa-screen">
        <p>{t("plugins.notFound")}</p>
      </div>
    );
  }
  return (
    // The plugin draws its own heading, so the frame is the whole screen.
    <div className="gfa-plugin-screen-wrap">
      <PluginScreenFrame
        key={`${plugin.id}/${found.id}`}
        plugin={plugin}
        screen={found}
        failedText={t("plugins.failed", { plugin: plugin.title })}
      />
    </div>
  );
}

/** Site Settings: its sidebar, and the tab chosen, beside it. */
function SettingsLayout({ sub, rest, params }: { sub?: string; rest: string[]; params: URLSearchParams }) {
  const tab = SETTINGS_TABS.includes(sub as SettingsTab) ? (sub as SettingsTab) : undefined;
  const screens = {
    domain: DomainScreen,
    editors: EditorsScreen,
    themes: ThemesScreen,
    plugins: PluginsScreen,
    updates: UpdatesScreen,
    history: SiteHistoryScreen,
    comments: CommentsScreen,
    import: ImportScreen,
    security: SecurityScreen,
  } as const;
  const Own = sub && sub in screens ? screens[sub as keyof typeof screens] : undefined;
  const section = Object.values(SETTINGS_SECTIONS).find((name) => name === params.get("section"));
  if (sub === "plugin") {
    const [id, screen] = rest;
    return (
      <div className="gfa-settings">
        <SettingsSidebar current={`plugin/${id}/${screen}`} />
        <div className="gfa-settings-content">
          <PluginScreen id={id} screen={screen} />
        </div>
      </div>
    );
  }
  return (
    <div className="gfa-settings">
      <SettingsSidebar current={(Own ? sub : (tab ?? "general")) as SettingsPlace} />
      <div className="gfa-settings-content">
        {Own ? <Own /> : <SettingsScreen tab={tab ?? "general"} section={section} />}
      </div>
    </div>
  );
}

function Screen() {
  const { segments, params } = useRoute();
  const [section, sub, tab] = segments;
  const owner = useCanChangeSettings();
  const { contentOnly } = useAdmin();

  if ((section === "blocks" || section === "settings") && !owner) return <OwnersOnly />;
  if (section === "media") return <MediaScreen />;
  if (section === "blocks") return contentOnly ? <BlocksInCode /> : <BlocksScreen />;
  if (section === "collections") {
    return sub ? <CollectionRoute id={sub} sub={tab} slug={params.get("slug") ?? ""} /> : <CollectionsScreen />;
  }

  if (section === "pages" && sub === "edit") return <PageEditorScreen path={params.get("path") ?? "/"} />;
  if (section === "layout") {
    return (
      <LayoutEditorScreen
        part={sub === "footer" ? "footer" : "header"}
        language={params.get("language") ?? undefined}
      />
    );
  }
  if (section === "versions") return <VersionsScreen file={params.get("file") ?? ""} />;
  if (section === "settings") return <SettingsLayout sub={sub} rest={segments.slice(2)} params={params} />;
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
  const { demo, drafts } = useAdmin();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!demo) return null;
  const startOver = async () => {
    setBusy(true);
    await drafts.discard();
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

/**
 * The draft being worked in, on every screen, with what can be done with it;
 * or, without one, the drafts waiting to be published, which can be opened.
 */
function DraftBanner() {
  const t = useStrings();
  const { drafts, state, limits } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<string>();
  const [notice, setNotice] = useState<
    | { type: "published" | "gone" }
    | { type: "submitted"; url: string }
    | { type: "error"; message: StringKey; error: unknown }
  >();
  const { current, names, kept } = drafts;
  if (state.status === "error") return null;
  if (!current && names.length === 0 && !notice) return null;

  // Opening a draft, or going back to the live site, shows every screen again: changes not added would be lost.
  const switchTo = async (name: string | undefined) => {
    if (hasUnsavedChanges() && !window.confirm(t("unsaved.confirm"))) return;
    setNotice(undefined);
    setBusy(true);
    const opened = await drafts.open(name).catch(() => false);
    setBusy(false);
    if (!opened) setNotice({ type: "gone" });
  };
  const run = async (action: () => Promise<void>) => {
    setNotice(undefined);
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const publishAll = () =>
    run(async () => {
      if (hasUnsavedChanges() && !window.confirm(t("unsaved.confirm"))) return;
      const result = await drafts.publishAll();
      if (result.ok) setNotice({ type: "published" });
      else if (result.reason !== "checks") {
        const message = result.reason === "conflict" ? (kept ? "draft.conflictKept" : "draft.conflict") : "draft.error";
        setNotice({ type: "error", message, error: result.error });
      }
    });
  const submit = () =>
    run(async () => {
      const result = await drafts.submit();
      setNotice(
        result.ok
          ? { type: "submitted", url: result.url }
          : { type: "error", message: "draft.submitError", error: result.error },
      );
    });
  const discard = () =>
    run(async () => {
      const result = await drafts.discard();
      setConfirming(false);
      if (!result.ok) setNotice({ type: "error", message: "draft.discardError", error: result.error });
    });

  const reviewed = new Map(drafts.reviews.map((review) => [review.name, review]));
  const others = names.filter((name) => name !== current?.name);
  // Those who can publish everything are asked first about drafts waiting for their review.
  const forReview = limits ? [] : others.filter((name) => reviewed.has(name));
  const waiting = forReview.length > 0 ? forReview : others;
  const selected = chosen && waiting.includes(chosen) ? chosen : waiting[0];
  const currentReview = current ? reviewed.get(current.name) : undefined;
  const selectedReview = selected ? reviewed.get(selected) : undefined;
  return (
    <section className="gfa-draft-banner" aria-label={t("draft.label")}>
      {current ? (
        <>
          <span>{t(kept ? "draft.bannerKept" : "draft.banner", { date: draftStarted(current.name) })}</span>
          {currentReview && (
            <span>
              {t("draft.inReview")}{" "}
              <a href={currentReview.url} target="_blank" rel="noreferrer">
                {t("draft.seeReview")}
              </a>
            </span>
          )}
          {current.paths.length > 0 && (
            <span className="gfa-draft-count">
              {current.paths.length === 1
                ? t("draft.oneChange")
                : t("draft.changes", { count: String(current.paths.length) })}
            </span>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void publishAll()}>
            {t("draft.publishAll")}
          </Button>
          {!kept && (
            <Button disabled={busy} onClick={() => void submit()}>
              {t("draft.submit")}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            {t("draft.discard")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void switchTo(undefined)}>
            {t("draft.leave")}
          </Button>
        </>
      ) : (
        waiting.length > 0 && (
          <>
            <span>
              {forReview.length > 0
                ? waiting.length === 1
                  ? t("draft.reviewWaiting", { title: selectedReview?.title ?? "" })
                  : t("draft.reviewWaitingMany", { count: String(waiting.length) })
                : waiting.length === 1
                  ? t("draft.waiting", { date: draftStarted(waiting[0] ?? "") })
                  : t("draft.waitingMany", { count: String(waiting.length) })}
            </span>
            {waiting.length > 1 && (
              <select
                aria-label={t("draft.choose")}
                value={selected}
                onChange={(event) => setChosen(event.target.value)}
              >
                {waiting.map((name) => (
                  <option key={name} value={name}>
                    {reviewed.get(name)?.title ?? t("draft.started", { date: draftStarted(name) })}
                  </option>
                ))}
              </select>
            )}
            <Button disabled={busy} onClick={() => void switchTo(selected)}>
              {t("draft.open")}
            </Button>
            {forReview.length > 0 && selectedReview && (
              <a href={selectedReview.url} target="_blank" rel="noreferrer">
                {t("draft.seeReview")}
              </a>
            )}
          </>
        )
      )}
      {busy && notice === undefined && current && <span role="status">{t("draft.publishing")}</span>}
      {notice?.type === "published" && <span role="status">{t("draft.published")}</span>}
      {notice?.type === "gone" && <span role="status">{t("draft.gone")}</span>}
      {notice?.type === "submitted" && (
        <span role="status">
          {t("draft.submitted")}{" "}
          <a href={notice.url} target="_blank" rel="noreferrer">
            {t("draft.seeReview")}
          </a>
        </span>
      )}
      {notice?.type === "error" && <ErrorMessage message={t(notice.message)} error={notice.error} />}
      {confirming && (
        <Dialog title={t("draft.discardTitle")} onClose={() => setConfirming(false)}>
          <p>{t("draft.discardBody")}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void discard()}>
              {t("draft.discard")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
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

/** The admin panel's language, remembered in this browser; each named in itself, so anyone finds their own. */
function LanguageMenu() {
  const t = useStrings();
  const language = useAdminLanguage();
  return (
    <label className="gfa-language">
      <span className="gfa-visually-hidden">{t("adminLanguage.label")}</span>
      <select
        value={language}
        title={t("adminLanguage.label")}
        onChange={(event) => {
          if (isAdminLanguage(event.target.value)) setAdminLanguage(event.target.value);
        }}
      >
        {ADMIN_LANGUAGES.map(({ code, name }) => (
          <option key={code} value={code} lang={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Dark mode on or off, remembered in this browser. A switch takes less room
 * in the header than a list, which phones need for the menu button.
 */
function DarkModeSwitch() {
  const t = useStrings();
  const dark = useDarkMode();
  return (
    <button
      type="button"
      role="switch"
      className="gfa-dark-switch"
      aria-checked={dark}
      aria-label={t("appearance.darkMode")}
      title={t("appearance.darkMode")}
      onClick={() => setDarkMode(!dark)}
    >
      <span className="gfa-dark-switch-thumb" aria-hidden="true">
        {dark ? <Moon size={12} /> : <Sun size={12} />}
      </span>
    </button>
  );
}

/**
 * The header's links, the site's address and the account, which narrow
 * windows show under a menu button: closed again by choosing a link, pressing
 * Escape or clicking elsewhere.
 */
function useTopbarMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const here = useRoute().segments.join("/");
  // biome-ignore lint/correctness/useExhaustiveDependencies: another screen, such as after Back, closes it
  useEffect(() => setOpen(false), [here]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    // Choosing a link closes it, even the one to the screen already shown.
    const onChoose = (event: MouseEvent) => {
      if ((event.target as Element).closest("a")) setOpen(false);
    };
    const shown = panel.current;
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    shown?.addEventListener("click", onChoose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      shown?.removeEventListener("click", onChoose);
    };
  }, [open]);
  return { open, setOpen, button, panel };
}

/** The part of the admin panel a file's Version history belongs to. */
function versionsSection(file: string): "pages" | "collections" | "layout" {
  if (file.startsWith(`${COLLECTIONS_DIR}/`)) return "collections";
  return file === HEADER_FILE || file === FOOTER_FILE ? "layout" : "pages";
}

function Shell() {
  const t = useStrings();
  const { state, siteUrl, contentOnly } = useAdmin();
  const owner = useCanChangeSettings();
  const { segments, params } = useRoute();
  const menu = useTopbarMenu();
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
        <div id="gfa-topbar-menu" className="gfa-topbar-menu" data-open={menu.open || undefined} ref={menu.panel}>
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
            {owner && !contentOnly && (
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
          <a className="gfa-topbar-link" href={siteUrl} target="_blank" rel="noreferrer">
            {t("app.viewSite")}
          </a>
          <AccountMenu />
          <LanguageMenu />
        </div>
        <DeployIndicator />
        <DarkModeSwitch />
        <button
          type="button"
          ref={menu.button}
          className="gfa-menu-button"
          aria-expanded={menu.open}
          aria-controls="gfa-topbar-menu"
          aria-label={t("nav.menu")}
          onClick={() => menu.setOpen(!menu.open)}
        >
          {menu.open ? <X size={20} aria-hidden="true" /> : <MenuIcon size={20} aria-hidden="true" />}
        </button>
      </header>
      <DemoBanner />
      <DraftBanner />
      <main className="gfa-content">
        {state.status === "loading" && <p className="gfa-screen">{t("loading")}</p>}
        {state.status === "error" && <LoadError error={state.error} />}
        {/* Opening a draft, or leaving one, starts the screen again with what it has, including forms that copied it. */}
        {state.status === "ready" && <Screen key={state.view} />}
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
export function Admin({ site, frames, store, host, server, preview, siteUrl = "/", strings, registry }: AdminProps) {
  // Light or dark everywhere, signing in included.
  useApplyThemeChoice();
  const demo = useMemo(() => (site.demo ? createDemoStore(siteUrl, store) : undefined), [site.demo, siteUrl, store]);
  // The admin panel's language, with any strings it was given over it.
  const language = useAdminText();
  const text = useMemo(() => {
    const table = { ...(language?.strings ?? defaultStrings), ...strings };
    // In a demo, "Published." would mislead: the changes are only saved in the browser.
    return demo ? { ...table, "publish.done": table["demo.published"] } : table;
  }, [language, demo, strings]);
  const editorText = useMemo(() => ({ puck: language?.puck ?? {}, labels: language?.labels ?? {} }), [language]);
  // Shown once the language has loaded, so nothing shows in English first.
  if (!language) return null;
  // The page tools such as the Claude connector take screenshots of drafts with; it signs nobody in.
  if (typeof location !== "undefined" && isPreviewAddress(location.hash)) {
    return (
      <StringsProvider strings={text}>
        <SitePreview frames={frames} preview={preview} siteUrl={siteUrl} />
      </StringsProvider>
    );
  }
  const body = demo ? (
    <AdminProvider site={site} frames={frames} store={demo} preview={preview} siteUrl={siteUrl} registry={registry}>
      <Shell />
    </AdminProvider>
  ) : store ? (
    <AdminProvider site={site} frames={frames} store={store} preview={preview} siteUrl={siteUrl} registry={registry}>
      <Shell />
    </AdminProvider>
  ) : server ? (
    <AppSignInGate api={server}>
      {(backend, session, signOut) => (
        <AdminProvider
          site={site}
          frames={frames}
          store={backend}
          account={{
            user: backend.user,
            hostName: host?.name ?? "",
            redirectAddressesListed: false,
            role: session.role,
            ...(session.ai.length > 0 && {
              ai: { server: new URL(`${server.replace(/\/+$/, "")}/ai`, location.href).href, services: session.ai },
            }),
            plugins: new URL(`${server.replace(/\/+$/, "")}/plugins`, location.href).href,
            ...(session.role === "owner" && { review: appServer(server).review }),
            ...(session.codeReview && { codeReview: true }),
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
  ) : site.broker ? (
    <BrokerGate broker={site.broker} host={host}>
      {(backend, account) => (
        <AdminProvider
          site={site}
          frames={frames}
          store={backend}
          account={{
            user: backend.user,
            hostName: account.hostName,
            redirectAddressesListed: account.redirectAddressesListed,
            ...(account.aiServices.length > 0 && {
              ai: { server: BROKER_AI_ADDRESS, services: account.aiServices, fetch: account.fetch },
            }),
            // The broker forgets the sign-in and its AI keys, and asks again.
            signOut: () => backend.signOut(),
          }}
          preview={preview}
          siteUrl={siteUrl}
          registry={registry}
          onSignInError={() => backend.signOut()}
        >
          <Shell />
        </AdminProvider>
      )}
    </BrokerGate>
  ) : host ? (
    <SignInGate host={host}>
      {(backend, signOut) => (
        <AdminProvider
          site={site}
          frames={frames}
          store={backend}
          account={{
            user: backend.user,
            hostName: host.name,
            redirectAddressesListed: host.canRedirect && host.redirectAddressesListed === true,
            ...(host.setup && { setup: host.setup }),
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
  return (
    <StringsProvider strings={text}>
      <EditorTextContext.Provider value={editorText}>{body}</EditorTextContext.Provider>
    </StringsProvider>
  );
}

/** Renders the admin panel into an element. */
export function mountAdmin(element: Element, props: AdminProps): void {
  createRoot(element).render(<Admin {...props} />);
}
