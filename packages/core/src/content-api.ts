/**
 * The content API (`@goodfellow-cms/core/content-api`): the site's content as
 * static JSON, which builds write beside its pages, and rich text as a simple
 * structure. An entry of its own, since it reads HTML with htmlparser2.
 */
export {
  type ApiCollectionsFile,
  type ApiData,
  type ApiEntry,
  type ApiFile,
  type ApiLayoutFile,
  type ApiManifest,
  type ApiPageFile,
  type ApiRedirect,
  type ApiRichText,
  type ApiSiteFile,
  apiPageFile,
  CONTENT_API_DIR,
  CONTENT_API_MANIFEST,
  type ContentApiFile,
  type ContentApiInput,
  type ContentApiPage,
  contentApiFiles,
} from "./content-api/files.js";
export {
  isMarkdownParts,
  markdownPartsNodes,
  type RichTextBlock,
  type RichTextInline,
  type RichTextText,
  richTextNodes,
} from "./content-api/rich-text.js";
