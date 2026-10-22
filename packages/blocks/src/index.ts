import type { Config } from "@puckeditor/core";
import { AddToCalendar, Calendar } from "./calendar.js";
import { Code } from "./code.js";
import { CollectionList, EntryField } from "./collections.js";
import { ContactDetails } from "./contact.js";
import { Button, Heading, Image, Text } from "./content.js";
import { DarkModeSwitch } from "./dark-mode-switch.js";
import { CollectionNav, EntryPager, OnThisPage } from "./docs.js";
import { Form } from "./form.js";
import { LanguageSwitch } from "./language-switch.js";
import { Flex, Grid, Section, Space } from "./layout.js";
import { CollectionLoop } from "./loop.js";
import { Menu, SiteBrand } from "./navigation.js";
import { Search } from "./search.js";
import { Video } from "./video.js";

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
export { Form, type FormField, type FormFieldType, type FormProps } from "./form.js";
export {
  CODE_LANGUAGES,
  type CodeColors,
  type CodeLanguage,
  codeLanguage,
  highlightCode,
  loadHighlighter,
} from "./highlight.js";
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
export { Menu, type MenuProps, SiteBrand, type SiteBrandProps } from "./navigation.js";
export { Search, type SearchProps } from "./search.js";
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
};

/** Groups for the editor's block list. */
export const categories = {
  layout: { title: "Layout", components: ["Section", "Grid", "Flex", "Space"] },
  content: {
    title: "Content",
    components: ["Heading", "Text", "Button", "Image", "Video", "Form", "Code", "ContactDetails"],
  },
  navigation: {
    title: "Navigation",
    components: ["Menu", "SiteBrand", "Search", "DarkModeSwitch", "LanguageSwitch", "CollectionNav"],
  },
  collections: {
    title: "Collections",
    components: [
      "CollectionList",
      "CollectionLoop",
      "Calendar",
      "EntryField",
      "AddToCalendar",
      "EntryPager",
      "OnThisPage",
    ],
  },
} satisfies Config["categories"];
