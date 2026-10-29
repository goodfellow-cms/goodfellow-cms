/**
 * The built-in blocks for apps made with Expo and `@goodfellow-cms/expo`,
 * by the same names as the website's (`blocks`): each draws, with React
 * Native, the props the content API gives it. They share their props'
 * types and what they show with the web blocks, and import none of the
 * web's code.
 */

import { AddToCalendar, Calendar } from "./calendar.native.js";
import { Code } from "./code.native.js";
import { CollectionList, EntryField } from "./collections.native.js";
import { ContactDetails } from "./contact.native.js";
import { Button, Heading, Image, Text } from "./content.native.js";
import { DarkModeSwitch } from "./dark-mode-switch.native.js";
import { CollectionNav, EntryPager, OnThisPage } from "./docs.native.js";
import { Embed } from "./embed.native.js";
import { Form } from "./form.native.js";
import { LanguageSwitch } from "./language-switch.native.js";
import { Flex, Grid, Section, Space } from "./layout.native.js";
import { CollectionLoop } from "./loop.native.js";
import { Audio, File, Gallery, MediaText } from "./media.native.js";
import { Breadcrumbs, Menu, PageList, SiteBrand } from "./navigation.native.js";
import { Search } from "./search.native.js";
import { Details, Preformatted, Pullquote, Separator, Table, Verse } from "./text.native.js";
import { Video } from "./video.native.js";

export { type CodeToken, type HighlightedCode, highlightedCode } from "./code-data.js";
export { ChoiceLinks, PageLinks } from "./listing.native.js";

/** Every built-in block for apps, keyed by the name content files use, as `blocks` is. */
export const nativeBlocks = {
  Section,
  Grid,
  Flex,
  Space,
  Heading,
  Text,
  Button,
  Image,
  Video,
  Embed,
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
};
