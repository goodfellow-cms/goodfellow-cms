import { NativeLink, SiteText, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import type { ContactDetailsProps } from "./contact.js";
import { phoneHref } from "./links.js";

/** The site's contact details, from Site settings: the phone number calls and the address emails. */
export function ContactDetails({ address, phone, email, layout }: ContactDetailsProps) {
  const { settings } = useNativeSite();
  const contact = settings.contact ?? {};
  const items = [
    address && contact.address && <SiteText key="address">{contact.address}</SiteText>,
    phone && contact.phone && (
      <NativeLink key="phone" href={phoneHref(contact.phone)}>
        <SiteText>{contact.phone}</SiteText>
      </NativeLink>
    ),
    email && contact.email && (
      <NativeLink key="email" href={`mailto:${contact.email}`}>
        <SiteText>{contact.email}</SiteText>
      </NativeLink>
    ),
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <View
      style={layout === "inline" ? { flexDirection: "row", flexWrap: "wrap", columnGap: 24, rowGap: 8 } : { gap: 8 }}
    >
      {items}
    </View>
  );
}
