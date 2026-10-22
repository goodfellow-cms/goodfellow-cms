import { FOOTER_FILE, HEADER_FILE, languageLayoutFile, siteLanguages } from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { layoutFileChange, pageFileChange, pageTitle } from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { PuckEditor } from "./puck-editor.js";
import { navigate } from "./router.js";
import { useStrings } from "./strings.js";
import { PageEditorTranslations } from "./translations.js";
import { Button } from "./ui.js";
import { AppLink } from "./use-link.js";
import { VersionsLink } from "./versions-screen.js";

export function PageEditorScreen({ path }: { path: string }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const page = content.pages.find((candidate) => candidate.path === path);

  if (!page) {
    return (
      <div className="gfa-screen">
        <p>{t("editPage.notFound")}</p>
        <AppLink href="#/pages">{t("editPage.backToPages")}</AppLink>
      </div>
    );
  }

  return (
    <PuckEditor
      key={page.path}
      kind="page"
      path={page.path}
      title={pageTitle(page)}
      data={page.content.data as Data}
      actions={
        <>
          <PageEditorTranslations page={page} />
          <VersionsLink file={page.file} />
        </>
      }
      toChanges={(data) => {
        const title =
          typeof data.root.props?.title === "string" && data.root.props.title.trim()
            ? data.root.props.title
            : page.path;
        return { changes: [pageFileChange(page.path, data, page.content)], message: t("editPage.message", { title }) };
      }}
    />
  );
}

/** Where the layout editor is, for a part and a language: the main language's without one. */
export function layoutEditorHref(part: "header" | "footer", language?: string): string {
  return `#/layout/${part}${language ? `?language=${encodeURIComponent(language)}` : ""}`;
}

export function LayoutEditorScreen({ part, language }: { part: "header" | "footer"; language?: string }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const languages = siteLanguages(content.settings);
  const chosen = languages.find((candidate) => candidate.code === language && !candidate.main);
  // Another language's own header or footer, or the main language's.
  const own = chosen ? content.languageLayouts?.[chosen.code]?.[part] : undefined;
  const file = chosen ? languageLayoutFile(part, chosen.code) : part === "header" ? HEADER_FILE : FOOTER_FILE;
  const partName = t(part === "header" ? "layout.header" : "layout.footer");
  // As it's named in a sentence.
  const partWord = t(part === "header" ? "layout.headerWord" : "layout.footerWord");

  /** Gives a language a header or footer of its own, starting as a copy of the main language's, or takes it away. */
  const change = async (copy: boolean) => {
    if (!chosen) return;
    setBusy(true);
    const result = await publish(
      copy ? [layoutFileChange(file, content[part].data as Data)] : [{ path: file, delete: true }],
      t(copy ? "layout.languageCopyMessage" : "layout.languageRemoveMessage", {
        part: partWord,
        language: chosen.name,
      }),
    );
    setBusy(false);
    if (!result.ok) setFailure(result);
  };

  return (
    <div className="gfa-layout-screen">
      <div className="gfa-layout-bar">
        <nav className="gfa-tabs" aria-label={t("nav.layout")}>
          {(["header", "footer"] as const).map((tab) => (
            <AppLink
              key={tab}
              href={layoutEditorHref(tab, chosen?.code)}
              aria-current={tab === part ? "page" : undefined}
              className="gfa-tab"
            >
              {t(tab === "header" ? "layout.header" : "layout.footer")}
            </AppLink>
          ))}
        </nav>
        {languages.length > 1 && (
          <label className="gfa-inline-field">
            {t("menus.language")}
            <select
              className="gfa-input"
              value={chosen?.code ?? ""}
              onChange={(event) =>
                navigate(layoutEditorHref(part, event.target.value || undefined), () =>
                  window.confirm(t("unsaved.confirm")),
                )
              }
            >
              {languages.map((candidate) => (
                <option key={candidate.code} value={candidate.main ? "" : candidate.code}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {chosen && !own ? (
        <div className="gfa-screen">
          <p>{t("layout.languageShared", { part: partWord, language: chosen.name })}</p>
          <PublishFailure failure={failure} />
          <Button variant="primary" disabled={busy} onClick={() => void change(true)}>
            {busy ? t("publish.publishing") : t("layout.languageCopy", { part: partWord, language: chosen.name })}
          </Button>
        </div>
      ) : (
        <PuckEditor
          key={`${part}-${chosen?.code ?? ""}`}
          kind={part}
          path={chosen ? chosen.prefix : "/"}
          title={chosen ? `${partName} (${chosen.name})` : partName}
          data={(own ?? content[part]).data as Data}
          {...(chosen && { language: chosen.code })}
          actions={
            <>
              {chosen && (
                <Button variant="ghost" disabled={busy} onClick={() => void change(false)}>
                  {t("layout.languageRemove", { part: partWord })}
                </Button>
              )}
              <VersionsLink file={file} />
            </>
          }
          toChanges={(data) => ({
            changes: [layoutFileChange(file, data)],
            message: chosen
              ? t("layout.languageMessage", { part: partWord, language: chosen.name })
              : t(part === "header" ? "layout.headerMessage" : "layout.footerMessage"),
          })}
        />
      )}
    </div>
  );
}
