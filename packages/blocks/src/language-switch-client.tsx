"use client";

import { type LanguageMap, languageLinksAt } from "@goodfellow-cms/core";
import { useCurrentPath } from "@goodfellow-cms/react";
import { LanguageList, type LanguageListProps } from "./language-switch-view.js";

/**
 * The Language switch in a layout shared by every page, such as Next.js's:
 * its links are worked out in the browser from the address being shown, so
 * they follow visitors from page to page.
 */
export function LayoutLanguageList({ map, ...props }: Omit<LanguageListProps, "links"> & { map: LanguageMap }) {
  const path = useCurrentPath() ?? "/";
  return <LanguageList links={languageLinksAt(map, path)} {...props} />;
}
