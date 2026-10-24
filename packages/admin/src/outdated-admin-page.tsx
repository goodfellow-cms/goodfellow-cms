import { Fragment } from "react";
import { type Strings, StringsProvider, useStrings } from "./strings.js";

export interface OutdatedAdminPageProps {
  /** The files to change, as the starter now has them. */
  files: readonly { path: string; content: string }[];
  strings?: Partial<Strings>;
}

/**
 * Shown in place of the admin panel by an admin page from before the editor's
 * frames, which loads the site's config, and every block's code, itself. It
 * never signs in, so no block's code runs beside a token.
 */
export function OutdatedAdminPage({ files, strings }: OutdatedAdminPageProps) {
  return (
    <StringsProvider strings={strings}>
      <Notice files={files} />
    </StringsProvider>
  );
}

function Notice({ files }: Pick<OutdatedAdminPageProps, "files">) {
  const t = useStrings();
  return (
    <div className="gfa-app">
      <main className="gfa-content">
        <div className="gfa-screen">
          <h1>{t("outdatedAdminPage.title")}</h1>
          <p>{t("outdatedAdminPage.message")}</p>
          <details className="gfa-details">
            <summary>{t("details.show")}</summary>
            <p>{t("outdatedAdminPage.details")}</p>
            {files.map((file) => (
              <Fragment key={file.path}>
                <p>
                  <code>{file.path}</code>
                </p>
                <pre>{file.content}</pre>
              </Fragment>
            ))}
          </details>
        </div>
      </main>
    </div>
  );
}
