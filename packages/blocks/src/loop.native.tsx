import { Blocks, Columns, NativeLink, SiteText, useBlocks, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import { GAPS } from "./layout.native.js";
import { ChoiceLinks, PageLinks } from "./listing.native.js";
import { currentListing } from "./listing-data.js";
import type { CollectionLoopProps } from "./loop.js";

const COLUMNS = {
  "1": { base: 1 },
  "2": { base: 1, md: 2 },
  "3": { base: 1, md: 3 },
  "4": { base: 1, sm: 2, lg: 4 },
} as const;

/**
 * Blocks designed in the editor, once for each of a collection's items: the
 * site's build made the copies, so each arrives with its item's values.
 */
export function CollectionLoop({
  design,
  items,
  item,
  columns,
  gap,
  linkToPage,
  emptyText,
  ...props
}: CollectionLoopProps & { id?: string }) {
  const site = useNativeSite();
  const copies = useBlocks(items);
  if (item) {
    const shown = <Blocks items={design} gap={12} />;
    return linkToPage && item.path ? (
      <NativeLink href={item.path} label={item.title}>
        {shown}
      </NativeLink>
    ) : (
      shown
    );
  }
  const listing = currentListing(props, site);
  if (!listing) return null;
  return (
    <View style={{ gap: 24 }}>
      <ChoiceLinks listing={listing} props={props} />
      {listing.entries.length === 0 ? (
        emptyText ? (
          <SiteText muted>{emptyText}</SiteText>
        ) : null
      ) : (
        <Columns columns={COLUMNS[columns] ?? COLUMNS["3"]} gap={GAPS[gap] ?? GAPS.md}>
          {copies}
        </Columns>
      )}
      <PageLinks listing={listing} props={props} />
    </View>
  );
}
