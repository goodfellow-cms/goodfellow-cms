import { Render as PuckRender } from "@puckeditor/core";
import type { ComponentProps } from "react";
import { createPageBody } from "./page-body-shared.js";
import { richTextTransforms } from "./rich-text.js";
import { SiteProvider } from "./site-context.js";

export type { PageBodyProps, PageContentProps, PageHeaderProps } from "./page-body-shared.js";
export { siteMetadata } from "./site-types.js";

function Render({ site: _site, ...props }: ComponentProps<typeof PuckRender> & { site: unknown }) {
  return <PuckRender {...props} fieldTransforms={richTextTransforms} />;
}

/**
 * Pages: `PageBody` is the site header, the page itself, and the site footer;
 * `PageHeader`, `PageContent`, and `PageFooter` are its parts.
 */
export const { PageBody, PageHeader, PageContent, PageFooter } = createPageBody({ Render, SiteProvider });
