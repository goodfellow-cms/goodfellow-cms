import { withIcon, withKeywords } from "@goodfellow-cms/react";
import type { Config } from "@puckeditor/core";
import { AnnouncementBar } from "./announcement.js";
import { AddToCalendar, Calendar } from "./calendar.js";
import { Code } from "./code.js";
import { CollectionList, EntryField } from "./collections.js";
import { ContactDetails } from "./contact.js";
import { Button, Heading, Image, Text } from "./content.js";
import { DarkModeSwitch } from "./dark-mode-switch.js";
import { CollectionNav, EntryPager, OnThisPage } from "./docs.js";
import { Embed } from "./embed.js";
import { Faq } from "./faq.js";
import { Form } from "./form.js";
import { BLOCK_ICONS } from "./icons.js";
import { BLOCK_KEYWORDS } from "./keywords.js";
import { LanguageSwitch } from "./language-switch.js";
import { Flex, Grid, Section, Space } from "./layout.js";
import { CollectionLoop } from "./loop.js";
import { Audio, Document, File, Gallery, MediaText } from "./media.js";
import { Breadcrumbs, Menu, PageList, SiteBrand } from "./navigation.js";
import { Newsletter } from "./newsletter.js";
import { Search } from "./search.js";
import { Donate, ShareButtons } from "./share.js";
import { SyncedBlock } from "./synced.js";
import { Details, Preformatted, Pullquote, Separator, Table, Verse } from "./text.js";
import { Video } from "./video.js";

export { AnnouncementBar, type AnnouncementBarProps } from "./announcement.js";
export {
  AddToCalendar,
  type AddToCalendarProps,
  Calendar,
  type CalendarItem,
  type CalendarProps,
  collectionItems,
  fetchFeed,
  googleCalendarLink,
  outlookLink,
  readFeed,
} from "./calendar.js";
export { Code, type CodeProps, CodeView } from "./code.js";
export {
  CollectionList,
  type CollectionListProps,
  EntryField,
  type EntryFieldProps,
  listedEntries,
} from "./collections.js";
export { ContactDetails, type ContactDetailsProps } from "./contact.js";
export {
  Button,
  type ButtonProps,
  Heading,
  type HeadingProps,
  Image,
  type ImageProps,
  Text,
  type TextProps,
} from "./content.js";
export { DarkModeSwitch, type DarkModeSwitchProps } from "./dark-mode-switch.js";
export {
  CollectionNav,
  type CollectionNavProps,
  EntryPager,
  type EntryPagerProps,
  OnThisPage,
  type OnThisPageProps,
} from "./docs.js";
export { Embed, type EmbedProps } from "./embed.js";
export { Faq, type FaqProps } from "./faq.js";
export { Form, type FormField, type FormFieldType, type FormProps } from "./form.js";
export {
  CODE_LANGUAGES,
  type CodeColors,
  type CodeLanguage,
  codeLanguage,
  highlightCode,
  loadHighlighter,
} from "./highlight.js";
export { BLOCK_ICONS } from "./icons.js";
export { BLOCK_KEYWORDS } from "./keywords.js";
export { LanguageSwitch, type LanguageSwitchProps } from "./language-switch.js";
export {
  Flex,
  type FlexProps,
  Grid,
  type GridProps,
  Section,
  type SectionProps,
  Space,
  type SpaceProps,
} from "./layout.js";
export {
  type ListingProps,
  type Order,
  type Show,
  selectedEntries,
} from "./listing.js";
export { CollectionLoop, type CollectionLoopProps } from "./loop.js";
export {
  Audio,
  type AudioProps,
  Document,
  type DocumentProps,
  File,
  type FileProps,
  Gallery,
  type GalleryImage,
  type GalleryProps,
  MediaText,
  type MediaTextProps,
} from "./media.js";
export {
  Breadcrumbs,
  type BreadcrumbsProps,
  Menu,
  type MenuProps,
  PageList,
  type PageListProps,
  SiteBrand,
  type SiteBrandProps,
} from "./navigation.js";
export {
  NEWSLETTER_SERVICES,
  Newsletter,
  type NewsletterProps,
  type NewsletterService,
  newsletterTarget,
} from "./newsletter.js";
export { Search, type SearchProps } from "./search.js";
export { Donate, type DonateProps, ShareButtons, type ShareButtonsProps, type ShareSite } from "./share.js";
export { SyncedBlock, type SyncedBlockProps } from "./synced.js";
export {
  Details,
  type DetailsProps,
  Preformatted,
  type PreformattedProps,
  Pullquote,
  type PullquoteProps,
  Separator,
  type SeparatorProps,
  Table,
  type TableProps,
  Verse,
  type VerseProps,
} from "./text.js";
export { Video, type VideoProps } from "./video.js";

/**
 * Every built-in block, keyed by the name stored in content files. Never rename
 * a key: existing pages refer to blocks by these names.
 */
export const blocks = {
  Section,
  Grid,
  Flex,
  Space,
  Heading,
  Text,
  Button,
  Image,
  Video,
  Form,
  Newsletter,
  Code,
  ContactDetails,
  Menu,
  SiteBrand,
  Search,
  DarkModeSwitch,
  LanguageSwitch,
  CollectionNav,
  CollectionList,
  CollectionLoop,
  Calendar,
  EntryField,
  AddToCalendar,
  EntryPager,
  OnThisPage,
  Separator,
  Pullquote,
  Preformatted,
  Verse,
  Details,
  Table,
  File,
  Audio,
  MediaText,
  Gallery,
  PageList,
  Breadcrumbs,
  Embed,
  Document,
  ShareButtons,
  Donate,
  SyncedBlock,
  Faq,
  AnnouncementBar,
};

for (const [name, keywords] of Object.entries(BLOCK_KEYWORDS)) {
  const block = (blocks as Record<string, object>)[name];
  if (block) withKeywords(block, keywords);
}

for (const [name, icon] of Object.entries(BLOCK_ICONS)) {
  const block = (blocks as Record<string, object>)[name];
  if (block) withIcon(block, icon);
}

/**
 * Groups for the editor's block list, which the editor opens for what's
 * edited (`OPEN_CATEGORIES` in `@goodfellow-cms/react`): all but Navigation
 * and Collections for pages, Layout and Navigation for the header and footer.
 */
export const categories = {
  layout: {
    title: "Layout",
    components: [
      "Section",
      "Grid",
      "Flex",
      "Space",
      "Separator",
      "MediaText",
      "Details",
      "SyncedBlock",
      "AnnouncementBar",
    ],
  },
  content: {
    title: "Text",
    components: ["Heading", "Text", "Faq", "Pullquote", "Table", "Preformatted", "Verse", "Code"],
  },
  forms: {
    title: "Buttons and forms",
    components: ["Button", "Donate", "ShareButtons", "Form", "Newsletter", "ContactDetails"],
  },
  media: {
    title: "Media",
    components: ["Image", "Gallery", "Video", "Embed", "Audio", "File", "Document"],
  },
  navigation: {
    title: "Navigation",
    components: [
      "Menu",
      "SiteBrand",
      "Search",
      "DarkModeSwitch",
      "LanguageSwitch",
      "CollectionNav",
      "PageList",
      "Breadcrumbs",
      "OnThisPage",
    ],
  },
  collections: {
    title: "Collections",
    components: ["CollectionList", "CollectionLoop", "Calendar", "EntryField", "AddToCalendar", "EntryPager"],
  },
} satisfies Config["categories"];
