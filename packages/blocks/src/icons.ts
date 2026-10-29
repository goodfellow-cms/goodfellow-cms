// Made by scripts/icons.mjs from lucide-react 1.52.0's icon data. Don't edit it by hand.
//
// ISC License
//
// Copyright (c) 2026 Lucide Icons and Contributors
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
import type { BlockIcon } from "@goodfellow-cms/core";

/** Each built-in block's icon in the block list, Lucide's (lucide.dev). */
export const BLOCK_ICONS: Readonly<Record<string, BlockIcon>> = {
  Section: [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M9 21V9" }],
  ],
  Grid: [
    ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }],
  ],
  Flex: [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M9 3v18" }],
    ["path", { d: "M15 3v18" }],
  ],
  Space: [
    ["path", { d: "M12 22v-6" }],
    ["path", { d: "M12 8V2" }],
    ["path", { d: "M4 12H2" }],
    ["path", { d: "M10 12H8" }],
    ["path", { d: "M16 12h-2" }],
    ["path", { d: "M22 12h-2" }],
    ["path", { d: "m15 19-3 3-3-3" }],
    ["path", { d: "m15 5-3-3-3 3" }],
  ],
  Separator: [
    ["path", { d: "m16 16-4 4-4-4" }],
    ["path", { d: "M3 12h18" }],
    ["path", { d: "m8 8 4-4 4 4" }],
  ],
  MediaText: [
    ["rect", { width: "7", height: "18", x: "3", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" }],
  ],
  Details: [
    ["path", { d: "M10 5h11" }],
    ["path", { d: "M10 12h11" }],
    ["path", { d: "M10 19h11" }],
    ["path", { d: "m3 10 3-3-3-3" }],
    ["path", { d: "m3 20 3-3-3-3" }],
  ],
  Heading: [
    ["path", { d: "M6 12h12" }],
    ["path", { d: "M6 20V4" }],
    ["path", { d: "M18 20V4" }],
  ],
  Text: [
    ["path", { d: "M13 4v16" }],
    ["path", { d: "M17 4v16" }],
    ["path", { d: "M19 4H9.5a4.5 4.5 0 0 0 0 9H13" }],
  ],
  Button: [
    ["path", { d: "M14 4.1 12 6" }],
    ["path", { d: "m5.1 8-2.9-.8" }],
    ["path", { d: "m6 12-1.9 2" }],
    ["path", { d: "M7.2 2.2 8 5.1" }],
    [
      "path",
      {
        d: "M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z",
      },
    ],
  ],
  Pullquote: [
    [
      "path",
      {
        d: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
      },
    ],
    [
      "path",
      {
        d: "M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
      },
    ],
  ],
  Table: [
    ["path", { d: "M12 3v18" }],
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M3 15h18" }],
  ],
  Preformatted: [
    [
      "path",
      {
        d: "M14 16.5a.5.5 0 0 0 .5.5h.5a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4h.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V8a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z",
      },
    ],
  ],
  Verse: [
    ["path", { d: "M15 12h-5" }],
    ["path", { d: "M15 8h-5" }],
    ["path", { d: "M19 17V5a2 2 0 0 0-2-2H4" }],
    [
      "path",
      {
        d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",
      },
    ],
  ],
  Code: [
    ["path", { d: "m18 16 4-4-4-4" }],
    ["path", { d: "m6 8-4 4 4 4" }],
    ["path", { d: "m14.5 4-5 16" }],
  ],
  Form: [
    ["rect", { width: "8", height: "4", x: "8", y: "2", rx: "1", ry: "1" }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M12 11h4" }],
    ["path", { d: "M12 16h4" }],
    ["path", { d: "M8 11h.01" }],
    ["path", { d: "M8 16h.01" }],
  ],
  ContactDetails: [
    ["path", { d: "M16 2v2" }],
    ["path", { d: "M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2" }],
    ["path", { d: "M8 2v2" }],
    ["circle", { cx: "12", cy: "10", r: "3" }],
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
  ],
  Image: [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" }],
    ["circle", { cx: "9", cy: "9", r: "2" }],
    ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }],
  ],
  Gallery: [
    ["path", { d: "m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" }],
    ["path", { d: "M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" }],
    ["circle", { cx: "13", cy: "7", r: "1", fill: "currentColor" }],
    ["rect", { x: "8", y: "2", width: "14", height: "14", rx: "2" }],
  ],
  Video: [
    ["path", { d: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" }],
    ["rect", { x: "2", y: "6", width: "14", height: "12", rx: "2" }],
  ],
  Audio: [
    ["path", { d: "M2 10v3" }],
    ["path", { d: "M6 6v11" }],
    ["path", { d: "M10 3v18" }],
    ["path", { d: "M14 8v7" }],
    ["path", { d: "M18 5v13" }],
    ["path", { d: "M22 10v3" }],
  ],
  File: [
    [
      "path",
      {
        d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
      },
    ],
    ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
    ["path", { d: "M12 18v-6" }],
    ["path", { d: "m9 15 3 3 3-3" }],
  ],
  Menu: [
    ["path", { d: "M4 5h16" }],
    ["path", { d: "M4 12h16" }],
    ["path", { d: "M4 19h16" }],
  ],
  SiteBrand: [
    [
      "path",
      {
        d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
      },
    ],
  ],
  Search: [
    ["path", { d: "M21 5H3" }],
    ["path", { d: "M10 12H3" }],
    ["path", { d: "M10 19H3" }],
    ["circle", { cx: "17", cy: "15", r: "3" }],
    ["path", { d: "m21 19-1.9-1.9" }],
  ],
  DarkModeSwitch: [
    ["path", { d: "M12 2v2" }],
    [
      "path",
      {
        d: "M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715",
      },
    ],
    ["path", { d: "M16 12a4 4 0 0 0-4-4" }],
    ["path", { d: "m19 5-1.256 1.256" }],
    ["path", { d: "M20 12h2" }],
  ],
  LanguageSwitch: [
    ["path", { d: "m5 8 6 6" }],
    ["path", { d: "m4 14 6-6 2-3" }],
    ["path", { d: "M2 5h12" }],
    ["path", { d: "M7 2h1" }],
    ["path", { d: "m22 22-5-10-5 10" }],
    ["path", { d: "M14 18h6" }],
  ],
  CollectionNav: [
    ["path", { d: "M8 5h13" }],
    ["path", { d: "M13 12h8" }],
    ["path", { d: "M13 19h8" }],
    ["path", { d: "M3 10a2 2 0 0 0 2 2h3" }],
    ["path", { d: "M3 5v12a2 2 0 0 0 2 2h3" }],
  ],
  PageList: [
    ["path", { d: "M3 5h.01" }],
    ["path", { d: "M3 12h.01" }],
    ["path", { d: "M3 19h.01" }],
    ["path", { d: "M8 5h13" }],
    ["path", { d: "M8 12h13" }],
    ["path", { d: "M8 19h13" }],
  ],
  Breadcrumbs: [
    [
      "path",
      {
        d: "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
      },
    ],
    [
      "path",
      {
        d: "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
      },
    ],
    ["path", { d: "M16 17h4" }],
    ["path", { d: "M4 13h4" }],
  ],
  CollectionList: [
    ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }],
    ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }],
    ["path", { d: "M14 4h7" }],
    ["path", { d: "M14 9h7" }],
    ["path", { d: "M14 15h7" }],
    ["path", { d: "M14 20h7" }],
  ],
  CollectionLoop: [
    ["path", { d: "m17 2 4 4-4 4" }],
    ["path", { d: "M3 11v-1a4 4 0 0 1 4-4h14" }],
    ["path", { d: "m7 22-4-4 4-4" }],
    ["path", { d: "M21 13v1a4 4 0 0 1-4 4H3" }],
  ],
  Calendar: [
    ["path", { d: "M8 2v3" }],
    ["path", { d: "M16 2v3" }],
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M8 13h.01" }],
    ["path", { d: "M12 13h.01" }],
    ["path", { d: "M16 13h.01" }],
    ["path", { d: "M8 17h.01" }],
    ["path", { d: "M12 17h.01" }],
    ["path", { d: "M16 17h.01" }],
  ],
  EntryField: [
    ["path", { d: "M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6" }],
    ["path", { d: "M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" }],
    ["path", { d: "M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" }],
    ["path", { d: "M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1" }],
    ["path", { d: "M9 6v12" }],
  ],
  AddToCalendar: [
    ["path", { d: "M16 18h6" }],
    ["path", { d: "M16 2v3" }],
    ["path", { d: "M19 15v6" }],
    ["path", { d: "M21 11.5V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h8.3" }],
    ["path", { d: "M3 9h18" }],
    ["path", { d: "M8 2v3" }],
  ],
  EntryPager: [
    ["path", { d: "M8 3 4 7l4 4" }],
    ["path", { d: "M4 7h16" }],
    ["path", { d: "m16 21 4-4-4-4" }],
    ["path", { d: "M20 17H4" }],
  ],
  OnThisPage: [
    ["path", { d: "M16 5H3" }],
    ["path", { d: "M16 12H3" }],
    ["path", { d: "M16 19H3" }],
    ["path", { d: "M21 5h.01" }],
    ["path", { d: "M21 12h.01" }],
    ["path", { d: "M21 19h.01" }],
  ],
};
