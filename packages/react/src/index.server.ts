// What Server Components (the "react-server" condition) get: the same API, without React context.

/** HTML that's safe to put in a page, for blocks that show HTML someone wrote: see `@goodfellow-cms/core`. */
export { sanitizeHtml } from "@goodfellow-cms/core";
export { BodyCode, HeadCode } from "./custom-code.js";
export { cx } from "./cx.js";
export {
  applyEntry,
  type EntryLoop,
  entryLoop,
  expandEntryLoops,
  type LoopItem,
  placeholderValues,
  repeatsForEntries,
} from "./entry.js";
export { SiteImage, SiteLink } from "./links.server.js";
export {
  PageBody,
  type PageBodyProps,
  PageContent,
  type PageContentProps,
  PageFooter,
  PageHeader,
  type PageHeaderProps,
  siteMetadata,
} from "./page-body.server.js";
export { useParts } from "./parts.server.js";
export { type ClassValue, type PartClasses, partClasses } from "./parts-shared.js";
export {
  applyPageEntry,
  createPuckConfigs,
  type PreparedLayout,
  type PreparedPage,
  type PuckConfigs,
  prepareLayout,
  preparePage,
  type RenderOptions,
} from "./prepare.js";
export {
  adminSite,
  type BlockParts,
  blockIcon,
  blockKeywords,
  blockParts,
  classNameField,
  createPuckConfig,
  describeSite,
  isStyleField,
  isTableField,
  isTemplateOnly,
  type MediaFieldKind,
  mediaField,
  mediaFieldKind,
  OPEN_CATEGORIES,
  type PuckConfigKind,
  type TableCells,
  tableCells,
  tableField,
  templateOnly,
  withClassName,
  withIcon,
  withKeywords,
  withParts,
} from "./puck-config.js";
export { CurrentPathProvider, useCurrentPath } from "./site-context.js";
export { type SiteContextValue, SiteProvider, useSite } from "./site-context.server.js";
export type { AdminLinkProps, AdminPlace, SiteComponents, SiteImageProps, SiteLinkProps } from "./site-types.js";
