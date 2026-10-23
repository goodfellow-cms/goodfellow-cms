import { cx, type SiteContextValue, siteMetadata } from "@goodfellow-cms/react";
import { type Config, type Data, Render } from "@puckeditor/core";
import type { ReactNode } from "react";

/** The site's header and footer, read-only, around a page's content, the way the live site shows them. */
export function SiteFrame({
  layoutConfig,
  header,
  footer,
  site,
  className,
  children,
}: {
  layoutConfig: Config;
  header: Data;
  footer: Data;
  site: SiteContextValue;
  className?: string;
  children: ReactNode;
}) {
  const metadata = siteMetadata(site);
  return (
    <>
      {header.content.length > 0 && (
        <header className="gf-header" inert>
          <Render config={layoutConfig} data={header} metadata={metadata} />
        </header>
      )}
      <main className={cx("gf-main", className)}>{children}</main>
      {footer.content.length > 0 && (
        <footer className="gf-footer" inert>
          <Render config={layoutConfig} data={footer} metadata={metadata} />
        </footer>
      )}
    </>
  );
}
