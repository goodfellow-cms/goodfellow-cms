import { todayIn } from "@goodfellow-cms/core";
import { NativeLink, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { AnnouncementBarProps } from "./announcement.js";
import { announcementShown } from "./announcement-data.js";

/** A band with a short message and a link, between its first and last days; closed, it stays closed while the app is open. */
export function AnnouncementBar({
  message,
  href,
  linkLabel,
  colors = "primary",
  showFrom,
  hideAfter,
  closable,
  closeLabel = "Close",
}: AnnouncementBarProps) {
  const site = useNativeSite();
  const [closed, setClosed] = useState(false);
  const text = message?.trim() ?? "";
  if (!text || closed || !announcementShown({ showFrom, hideAfter }, todayIn(site.settings.timeZone)).shown)
    return null;
  const { colors: theme } = site.theme;
  const [background, foreground] =
    colors === "secondary"
      ? [theme.secondary, theme.secondaryForeground]
      : colors === "muted"
        ? [theme.muted, theme.foreground]
        : [theme.primary, theme.primaryForeground];
  return (
    <View
      style={{
        backgroundColor: background,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
      }}
    >
      <SiteText style={{ color: foreground, fontSize: TEXT.sm, textAlign: "center", flexShrink: 1 }}>
        {text}
        {href?.trim() && linkLabel?.trim() ? " " : ""}
      </SiteText>
      {href?.trim() && linkLabel?.trim() ? (
        <NativeLink href={href.trim()}>
          <SiteText
            style={{ color: foreground, fontSize: TEXT.sm, fontWeight: "600", textDecorationLine: "underline" }}
          >
            {linkLabel.trim()}
          </SiteText>
        </NativeLink>
      ) : null}
      {closable ? (
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={() => setClosed(true)}>
          <SiteText style={{ color: foreground, fontSize: TEXT.lg }}>×</SiteText>
        </Pressable>
      ) : null}
    </View>
  );
}
