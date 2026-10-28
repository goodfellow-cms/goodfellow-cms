/** What Collection list and Collection loop share in apps: the links between their pages. */

import { NativeLink, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import { choicePageList, type Listing, type ListingProps, listingDefaults, listingPath } from "./listing-data.js";

function Pill({ label, href, current }: { label: string; href: string; current: boolean }) {
  const { colors } = useNativeSite().theme;
  return (
    <NativeLink
      href={href}
      style={{
        borderWidth: 1,
        borderColor: current ? colors.primary : colors.border,
        backgroundColor: current ? colors.primary : "transparent",
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 4,
      }}
    >
      <SiteText style={{ fontSize: TEXT.sm, ...(current && { color: colors.primaryForeground }) }}>{label}</SiteText>
    </NativeLink>
  );
}

/** Links to a list's pages for each choice, with "All" first. */
export function ChoiceLinks({ listing, props: stored }: { listing: Listing; props: Partial<ListingProps> }) {
  const props = { ...listingDefaults, ...stored };
  const choices = props.choicePages ? choicePageList(listing.collection, props.choicePages) : [];
  if (!listing.linked || choices.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Pill label={props.allLabel} href={listing.path} current={listing.choice === undefined} />
      {choices.map((choice) => (
        <Pill
          key={choice.value}
          label={choice.label}
          href={listingPath(listing.path, props, choice)}
          current={listing.choice === choice.value}
        />
      ))}
    </View>
  );
}

/** Links to a list's other pages: previous, each page's number, and next. */
export function PageLinks({ listing, props: stored }: { listing: Listing; props: Partial<ListingProps> }) {
  const { colors, radius } = useNativeSite().theme;
  const props = { ...listingDefaults, ...stored };
  if (!listing.linked || listing.pages <= 1) return null;
  const choice = listing.choice
    ? choicePageList(listing.collection, props.choicePages).find((item) => item.value === listing.choice)
    : undefined;
  const href = (page: number) => listingPath(listing.path, props, choice, page);
  const link = (label: string, page: number, current = false) => (
    <NativeLink
      key={label}
      href={href(page)}
      style={{
        minWidth: 36,
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radius,
        ...(current && { backgroundColor: colors.primary }),
      }}
    >
      <SiteText style={{ fontSize: TEXT.sm, ...(current && { color: colors.primaryForeground }) }}>{label}</SiteText>
    </NativeLink>
  );
  return (
    <View
      accessibilityLabel={props.pagesLabel}
      style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 }}
    >
      {listing.page > 1 && link(`← ${props.previousLabel}`, listing.page - 1)}
      {Array.from({ length: listing.pages }, (_, index) =>
        link(String(index + 1), index + 1, index + 1 === listing.page),
      )}
      {listing.page < listing.pages && link(`${props.nextLabel} →`, listing.page + 1)}
    </View>
  );
}
