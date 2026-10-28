import { SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { LanguageSwitchProps } from "./language-switch.js";

/** The page in each of the site's languages, each named in itself: choosing one shows the site in it. */
export function LanguageSwitch({ display, label }: LanguageSwitchProps) {
  const site = useNativeSite();
  const [open, setOpen] = useState(false);
  const links = site.languages;
  if (!links || links.length < 2) return null;
  const current = links.find((language) => language.current) ?? links[0];
  const list = (
    <View style={{ flexDirection: display === "menu" ? "column" : "row", flexWrap: "wrap", gap: 4 }}>
      {links.map((language) => (
        <Pressable
          key={language.code}
          accessibilityRole="link"
          accessibilityLanguage={language.code}
          accessibilityState={{ selected: language.current }}
          onPress={() => {
            setOpen(false);
            if (language.current) return;
            site.setLanguage(language.code);
            site.open(language.path);
          }}
          style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        >
          <SiteText
            muted={!language.current}
            style={{ fontSize: TEXT.sm, fontWeight: language.current ? "600" : "400" }}
          >
            {language.name}
          </SiteText>
        </Pressable>
      ))}
    </View>
  );
  if (display !== "menu") return <View accessibilityLabel={label}>{list}</View>;
  return (
    <View accessibilityLabel={label}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ paddingHorizontal: 8, paddingVertical: 4 }}
      >
        <SiteText style={{ fontSize: TEXT.sm }}>
          {current?.name} {open ? "▴" : "▾"}
        </SiteText>
      </Pressable>
      {open && list}
    </View>
  );
}
