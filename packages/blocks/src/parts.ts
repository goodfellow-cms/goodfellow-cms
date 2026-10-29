import type { BlockParts } from "@goodfellow-cms/react";

// The named parts built-in blocks render (`useParts()`), with what owners call
// them, which `withParts()` gives each block. Themes give these names classes,
// so they're part of a site's look: add names, never rename or remove one.

export const CODE_PARTS: BlockParts = {
  "gf-code": "Code",
  "gf-code-title": "Code's title",
  "gf-code-copy": "Copy button",
};

export const ADD_TO_CALENDAR_PARTS: BlockParts = {
  "gf-add-to-calendar": "Add to calendar",
  "gf-add-to-calendar-label": "Add to calendar's label",
  "gf-add-to-calendar-links": "Calendars' links",
  "gf-add-to-calendar-link": "Calendar's link",
};

export const CHOICE_PARTS: BlockParts = {
  "gf-choices": "Choices",
  "gf-choice-link": "Choice",
};

export const PAGE_LINK_PARTS: BlockParts = {
  "gf-page-links": "Page links",
  "gf-page-numbers": "Page numbers",
  "gf-page-link": "Page link",
};

export const HEADING_PARTS: BlockParts = { "gf-heading": "Heading" };
export const TEXT_PARTS: BlockParts = { "gf-text": "Text" };
export const BUTTON_PARTS: BlockParts = { "gf-button": "Button" };

export const IMAGE_PARTS: BlockParts = {
  "gf-image": "Image and caption",
  "gf-image-picture": "Picture",
  "gf-image-caption": "Caption",
};

export const SECTION_PARTS: BlockParts = {
  "gf-section": "Section",
  "gf-section-content": "Section's content",
  "gf-section-overlay": "Section's overlay",
};

export const COLUMNS_PARTS: BlockParts = { "gf-columns": "Columns" };
export const ROW_PARTS: BlockParts = { "gf-row": "Row" };
export const SPACE_PARTS: BlockParts = { "gf-space": "Space" };

export const MENU_PARTS: BlockParts = {
  "gf-menu": "Menu",
  "gf-menu-list": "Menu's links",
  "gf-menu-item": "Menu item",
  "gf-menu-link": "Menu link",
  "gf-menu-submenu": "Submenu",
  "gf-menu-toggle": "Menu button and its links",
  "gf-menu-button": "Menu button",
  "gf-menu-panel": "Links under the menu button",
};

export const SITE_BRAND_PARTS: BlockParts = {
  "gf-site-brand": "Site name and logo",
  "gf-site-brand-logo": "Logo",
  "gf-site-brand-name": "Site name",
  "gf-site-brand-text": "Name and tagline",
  "gf-site-brand-tagline": "Tagline",
};

export const CONTACT_PARTS: BlockParts = {
  "gf-contact": "Contact details",
  "gf-contact-address": "Address",
  "gf-contact-phone": "Phone number",
  "gf-contact-email": "Email address",
};

export const SEARCH_PARTS: BlockParts = {
  "gf-search": "Search",
  "gf-search-box": "Search box",
  "gf-search-input": "Search field",
  "gf-search-results": "Results",
  "gf-search-result": "Result",
  "gf-search-result-title": "Result's title",
  "gf-search-result-excerpt": "Result's excerpt",
  "gf-search-message": "Search message",
};

export const DARK_MODE_SWITCH_PARTS: BlockParts = {
  "gf-dark-mode-switch": "Dark mode switch",
  "gf-dark-mode-switch-track": "Switch's track",
  "gf-dark-mode-switch-thumb": "Switch's knob",
};

export const LANGUAGE_SWITCH_PARTS: BlockParts = {
  "gf-language-switch": "Language switch",
  "gf-language-list": "Languages",
  "gf-language-link": "Language",
  "gf-language-current": "Current language",
};

export const VIDEO_PARTS: BlockParts = {
  "gf-video": "Video and caption",
  "gf-video-player": "Player",
  "gf-video-caption": "Caption",
};

export const FORM_PARTS: BlockParts = {
  "gf-form": "Form",
  "gf-form-embed": "Google Form",
  "gf-form-questions": "Questions",
  "gf-form-question": "Question",
  "gf-form-label": "Question's wording",
  "gf-form-hint": "Help text",
  "gf-form-input": "Answer field",
  "gf-form-choice": "Choice",
  "gf-form-check": "Checkbox or option",
  "gf-form-required": "Required mark",
  "gf-form-submit": "Send button",
};

export const NEWSLETTER_PARTS: BlockParts = {
  "gf-newsletter": "Newsletter signup",
  "gf-newsletter-heading": "Heading",
  "gf-newsletter-text": "Text",
  "gf-newsletter-form": "Form",
  "gf-newsletter-field": "Field",
  "gf-newsletter-label": "Field's label",
  "gf-newsletter-input": "Email box",
  "gf-newsletter-submit": "Subscribe button",
  "gf-newsletter-note": "Words under the form",
};

export const ENTRY_FIELD_PARTS: BlockParts = {
  "gf-entry-field": "Entry field",
  "gf-entry-field-link": "Field's link",
  ...CODE_PARTS,
};

export const COLLECTION_LIST_PARTS: BlockParts = {
  "gf-collection-list": "List with its heading",
  "gf-collection-list-header": "List's heading and link",
  "gf-collection-list-heading": "List's heading",
  "gf-collection-list-more": "See all link",
  "gf-collection-list-items": "Items",
  "gf-collection-list-empty": "Nothing to show",
  "gf-card": "Card",
  "gf-card-image": "Card's picture",
  "gf-card-body": "Card's text",
  "gf-card-date": "Card's date",
  "gf-card-title": "Card's title",
  "gf-card-summary": "Card's summary",
  "gf-list-item": "List item",
  "gf-list-item-image": "List item's picture",
  "gf-list-item-body": "List item's text",
  "gf-list-item-date": "List item's date",
  "gf-list-item-title": "List item's title",
  "gf-list-item-summary": "List item's summary",
  ...CHOICE_PARTS,
  ...PAGE_LINK_PARTS,
};

export const COLLECTION_LOOP_PARTS: BlockParts = {
  "gf-collection-loop": "Collection loop",
  "gf-collection-loop-items": "Items",
  "gf-collection-loop-item": "Item",
  "gf-collection-loop-design": "Item's design",
  "gf-collection-loop-empty": "Nothing to show",
  ...CHOICE_PARTS,
  ...PAGE_LINK_PARTS,
};

export const CALENDAR_PARTS: BlockParts = {
  "gf-calendar": "Calendar",
  "gf-calendar-empty": "Nothing to show",
  "gf-calendar-days": "Days",
  "gf-calendar-day": "Day",
  "gf-calendar-day-heading": "Day's date",
  "gf-calendar-events": "Day's events",
  "gf-calendar-event": "Event",
  "gf-calendar-event-time": "Event's time",
  "gf-calendar-event-body": "Event's details",
  "gf-calendar-event-title": "Event's title",
  "gf-calendar-event-place": "Event's place",
  "gf-calendar-event-summary": "Event's summary",
  "gf-calendar-month": "Month",
  "gf-calendar-month-header": "Month's heading and links",
  "gf-calendar-month-link": "Previous or next month",
  "gf-calendar-month-title": "Month's name",
  "gf-calendar-weekdays": "Days of the week",
  "gf-calendar-month-days": "Month's days",
  "gf-calendar-month-day": "Month's day",
  "gf-calendar-month-blank": "Day outside the month",
  "gf-calendar-month-date": "Day's number",
  "gf-calendar-month-events": "Day's events in a month",
  "gf-calendar-month-event": "Event in a month",
  "gf-calendar-subscribe": "Subscribe",
  "gf-calendar-subscribe-label": "Subscribe's label",
  "gf-calendar-subscribe-links": "Subscribe links",
  "gf-calendar-subscribe-link": "Subscribe link",
  ...ADD_TO_CALENDAR_PARTS,
};

export const COLLECTION_NAV_PARTS: BlockParts = {
  "gf-collection-nav": "Collection navigation",
  "gf-collection-nav-heading": "Navigation's heading",
  "gf-collection-nav-group": "Group",
  "gf-collection-nav-group-label": "Group's name",
  "gf-collection-nav-links": "Group's links",
  "gf-collection-nav-link": "Link",
};

export const ENTRY_PAGER_PARTS: BlockParts = {
  "gf-entry-pager": "Previous and next",
  "gf-entry-pager-link": "Previous or next link",
  "gf-entry-pager-label": "Link's label",
  "gf-entry-pager-title": "Link's title",
};

export const ON_THIS_PAGE_PARTS: BlockParts = {
  "gf-on-this-page": "On this page",
  "gf-on-this-page-heading": "Heading",
  "gf-on-this-page-links": "Links",
  "gf-on-this-page-link": "Link",
};

export const SEPARATOR_PARTS: BlockParts = { "gf-separator": "Separator" };

export const PULLQUOTE_PARTS: BlockParts = {
  "gf-pullquote": "Pullquote",
  "gf-pullquote-quote": "Quote",
  "gf-pullquote-citation": "Who said it",
};

export const PREFORMATTED_PARTS: BlockParts = { "gf-preformatted": "Preformatted text" };
export const VERSE_PARTS: BlockParts = { "gf-verse": "Verse" };

export const DETAILS_PARTS: BlockParts = {
  "gf-details": "Details",
  "gf-details-summary": "Summary",
  "gf-details-content": "What it shows",
};

export const TABLE_PARTS: BlockParts = {
  "gf-table": "Table and caption",
  "gf-table-grid": "Table",
  "gf-table-caption": "Caption",
  "gf-table-row": "Row",
  "gf-table-header-cell": "Heading cell",
  "gf-table-cell": "Cell",
};

export const DOCUMENT_PARTS: BlockParts = {
  "gf-document": "Document and link",
  "gf-document-frame": "Viewer",
  "gf-document-caption": "Below the viewer",
  "gf-document-link": "Link to the document",
};

export const SHARE_PARTS: BlockParts = {
  "gf-share": "Share buttons",
  "gf-share-label": "Words before the buttons",
  "gf-share-list": "Buttons",
  "gf-share-link": "Button",
};

export const DONATE_PARTS: BlockParts = {
  "gf-donate": "Donate",
  "gf-donate-heading": "Heading",
  "gf-donate-text": "Text",
  "gf-donate-button": "Button",
  "gf-donate-note": "Where people give",
};

export const FILE_PARTS: BlockParts = {
  "gf-file": "File",
  "gf-file-link": "File's link",
  "gf-file-button": "Download button",
};

export const AUDIO_PARTS: BlockParts = {
  "gf-audio": "Audio and caption",
  "gf-audio-player": "Player",
  "gf-audio-caption": "Caption",
};

export const MEDIA_TEXT_PARTS: BlockParts = {
  "gf-media-text": "Media and text",
  "gf-media-text-media": "Picture",
  "gf-media-text-content": "Text beside it",
};

export const GALLERY_PARTS: BlockParts = {
  "gf-gallery": "Gallery",
  "gf-gallery-items": "Pictures",
  "gf-gallery-item": "Picture and caption",
  "gf-gallery-picture": "Picture",
  "gf-gallery-item-caption": "Picture's caption",
  "gf-gallery-caption": "Gallery's caption",
};

export const BREADCRUMBS_PARTS: BlockParts = {
  "gf-breadcrumbs": "Breadcrumbs",
  "gf-breadcrumbs-list": "List of pages",
  "gf-breadcrumbs-item": "Page",
  "gf-breadcrumbs-link": "Page's link",
  "gf-breadcrumbs-separator": "Mark between pages",
  "gf-breadcrumbs-current": "This page",
};

export const PAGE_LIST_PARTS: BlockParts = {
  "gf-page-list": "Page list",
  "gf-page-list-item": "Page",
  "gf-page-list-link": "Page's link",
  "gf-page-list-children": "Pages under it",
};
