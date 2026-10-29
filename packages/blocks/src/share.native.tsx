import { NativeLink, SiteButton, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import {
  type DonateProps,
  givingNote,
  givingPage,
  pageAddress,
  SHARE_SITE_NAMES,
  type ShareButtonsProps,
  shareLink,
  shownSites,
} from "./share-data.js";

/** Links that share the page, opened in the phone's apps or browser. */
export function ShareButtons({ label, sites, look }: ShareButtonsProps) {
  const site = useNativeSite();
  const path = site.path ?? "/";
  const url = pageAddress(site.settings.url, path);
  const shown = shownSites(sites);
  if (!url || shown.length === 0) return null;
  const title = (site.entry?.content.fields.title as string | undefined) || site.settings.title;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {label ? <SiteText style={{ fontWeight: "500" }}>{label}</SiteText> : null}
      {shown.map((where) =>
        look === "links" ? (
          <NativeLink key={where} href={shareLink(where, url, title)}>
            <SiteText style={{ textDecorationLine: "underline" }}>{SHARE_SITE_NAMES[where]}</SiteText>
          </NativeLink>
        ) : (
          <SiteButton
            key={where}
            label={SHARE_SITE_NAMES[where]}
            href={shareLink(where, url, title)}
            variant="outline"
            size="sm"
          />
        ),
      )}
    </View>
  );
}

/** A button to the site's giving page, which opens in the phone's browser. */
export function Donate({ heading, text, url, buttonLabel, showNote, align }: DonateProps) {
  const page = givingPage(url);
  if (!page) return null;
  const centered = align === "center";
  return (
    <View style={{ gap: 12, alignItems: centered ? "center" : "flex-start" }}>
      {heading ? (
        <SiteText
          heading={2}
          style={{ fontSize: TEXT["2xl"], fontWeight: "600", textAlign: centered ? "center" : "left" }}
        >
          {heading}
        </SiteText>
      ) : null}
      {text ? (
        <SiteText muted style={{ textAlign: centered ? "center" : "left" }}>
          {text}
        </SiteText>
      ) : null}
      <SiteButton label={buttonLabel || "Give"} href={page.url} />
      {showNote ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {givingNote(page.service)}
        </SiteText>
      ) : null}
    </View>
  );
}
