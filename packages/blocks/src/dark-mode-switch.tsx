import { classNameField, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { ColorSchemeControl } from "./dark-mode-switch-client.js";
import { options } from "./options.js";

export interface DarkModeSwitchProps {
  display: "switch" | "menu";
  labels: "show" | "hide";
  label: string;
  lightLabel: string;
  darkLabel: string;
  systemLabel: string;
  className: string;
}

/**
 * Lets visitors choose light or dark colors on a site with dark mode, rather
 * than following their computer's setting. The choice is kept in their
 * browser and put back on every page before it's shown.
 */
export const DarkModeSwitch: ComponentConfig<DarkModeSwitchProps> = {
  label: "Dark mode switch",
  fields: {
    display: {
      type: "radio",
      label: "Show as",
      options: options({
        switch: "A switch between light and dark",
        menu: "A menu: light, dark or like the visitor's computer",
      }),
    },
    labels: { type: "radio", label: "Words beside the switch", options: options({ show: "Show", hide: "Hide" }) },
    label: { type: "text", label: "Name, for screen readers" },
    lightLabel: { type: "text", label: "Light" },
    darkLabel: { type: "text", label: "Dark" },
    systemLabel: { type: "text", label: "Following the computer's setting" },
    className: classNameField,
  },
  defaultProps: {
    display: "switch",
    labels: "hide",
    label: "Dark mode",
    lightLabel: "Light",
    darkLabel: "Dark",
    systemLabel: "Follow my computer",
    className: "",
  },
  // The switch's words only matter for the switch, and following the computer only for the menu.
  resolveFields: ({ props }, { fields }) => {
    const menu = props.display === "menu";
    return {
      ...fields,
      labels: { ...fields.labels, visible: !menu },
      systemLabel: { ...fields.systemLabel, visible: menu },
    };
  },
  render: ({ puck, id: _id, ...props }) => <DarkModeSwitchView {...props} isEditing={puck.isEditing} />,
};

function DarkModeSwitchView({ isEditing, ...stored }: Omit<DarkModeSwitchProps, "id"> & { isEditing: boolean }) {
  const { settings, adminLink } = useSite();
  // Stored props can leave settings out, such as an AI assistant's answer.
  const given = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined));
  const props = { ...DarkModeSwitch.defaultProps, ...given } as DarkModeSwitchProps;
  if (!settings.theme.darkMode) {
    if (!isEditing) return null;
    const link = adminLink?.("theme-settings");
    const text = "This switch shows once dark mode is on, in Site settings' Colors & fonts.";
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        {link ? (
          <a {...link} className="underline underline-offset-2 hover:text-foreground">
            {text}
          </a>
        ) : (
          text
        )}
      </p>
    );
  }
  return (
    <ColorSchemeControl
      display={props.display}
      showLabels={props.labels === "show"}
      label={props.label}
      lightLabel={props.lightLabel}
      darkLabel={props.darkLabel}
      systemLabel={props.systemLabel}
      interactive={!isEditing}
      className={props.className}
    />
  );
}
