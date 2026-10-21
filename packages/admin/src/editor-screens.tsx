import { FOOTER_FILE, HEADER_FILE } from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { useSiteContent } from "./admin-context.js";
import { layoutFileChange, pageFileChange, pageTitle } from "./changes.js";
import { PuckEditor } from "./puck-editor.js";
import { useStrings } from "./strings.js";
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
      actions={<VersionsLink file={page.file} />}
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

export function LayoutEditorScreen({ part }: { part: "header" | "footer" }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const file = part === "header" ? HEADER_FILE : FOOTER_FILE;

  return (
    <div className="gfa-layout-screen">
      <nav className="gfa-tabs" aria-label={t("nav.layout")}>
        {(["header", "footer"] as const).map((tab) => (
          <AppLink
            key={tab}
            href={`#/layout/${tab}`}
            aria-current={tab === part ? "page" : undefined}
            className="gfa-tab"
          >
            {t(tab === "header" ? "layout.header" : "layout.footer")}
          </AppLink>
        ))}
      </nav>
      <PuckEditor
        key={part}
        kind={part}
        path="/"
        title={t(part === "header" ? "layout.header" : "layout.footer")}
        data={content[part].data as Data}
        actions={<VersionsLink file={file} />}
        toChanges={(data) => ({
          changes: [layoutFileChange(file, data)],
          message: t(part === "header" ? "layout.headerMessage" : "layout.footerMessage"),
        })}
      />
    </div>
  );
}
