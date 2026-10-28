import { SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { Pressable, Switch, View } from "react-native";
import type { DarkModeSwitchProps } from "./dark-mode-switch.js";

/** Lets visitors choose light or dark colors, on a site with dark mode, rather than following the phone's setting. */
export function DarkModeSwitch({ display, labels, label, lightLabel, darkLabel, systemLabel }: DarkModeSwitchProps) {
  const site = useNativeSite();
  const { theme, colorScheme } = site;
  if (!site.settings.theme.darkMode) return null;
  if (display === "menu") {
    const choices = [
      { value: "light", label: lightLabel },
      { value: "dark", label: darkLabel },
      { value: undefined, label: systemLabel },
    ] as const;
    return (
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}
      >
        {choices.map((choice) => {
          const chosen = colorScheme === choice.value;
          return (
            <Pressable
              key={choice.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              onPress={() => site.setColorScheme(choice.value)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: theme.radius,
                backgroundColor: chosen ? theme.colors.muted : "transparent",
              }}
            >
              <SiteText style={{ fontSize: TEXT.sm, fontWeight: chosen ? "600" : "400" }}>{choice.label}</SiteText>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {labels === "show" && <SiteText style={{ fontSize: TEXT.sm }}>{lightLabel}</SiteText>}
      <Switch
        accessibilityLabel={label}
        value={theme.dark}
        onValueChange={(dark) => site.setColorScheme(dark ? "dark" : "light")}
        trackColor={{ true: theme.colors.primary, false: theme.colors.muted }}
      />
      {labels === "show" && <SiteText style={{ fontSize: TEXT.sm }}>{darkLabel}</SiteText>}
    </View>
  );
}
