import { classNameField, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { LayoutLanguageList } from "./language-switch-client.js";
import { LanguageList } from "./language-switch-view.js";
import { options } from "./options.js";
import { LANGUAGE_SWITCH_PARTS } from "./parts.js";

export interface LanguageSwitchProps {
  display: "links" | "menu";
  label: string;
  className: string;
}

/**
 * Links to the page in each of the site's languages: its translation, or the
 * language's home page where it has none. Each language is named in itself,
 * so visitors find their own. Plain links and `<details>`, with no JavaScript,
 * except in a layout shared by every page, which only the browser knows the
 * current page of.
 */
export const LanguageSwitch: ComponentConfig<LanguageSwitchProps> = withParts(
  {
    label: "Language switch",
    fields: {
      display: {
        type: "radio",
        label: "Show as",
        options: options({ links: "Links side by side", menu: "A menu that opens" }),
      },
      label: { type: "text", label: "Name, for screen readers" },
      className: classNameField,
    },
    defaultProps: { display: "links", label: "Languages", className: "" },
    render: ({ puck, id: _id, ...props }) => <LanguageSwitchView {...props} isEditing={puck.isEditing} />,
  },
  LANGUAGE_SWITCH_PARTS,
);

function LanguageSwitchView({ isEditing, ...stored }: Omit<LanguageSwitchProps, "id"> & { isEditing: boolean }) {
  const { languages, languageMap, adminLink } = useSite();
  // Stored props can leave settings out, such as an AI assistant's answer.
  const given = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined));
  const props = { ...LanguageSwitch.defaultProps, ...given } as LanguageSwitchProps;
  if ((!languages || languages.length < 2) && !languageMap) {
    if (!isEditing) return null;
    const link = adminLink?.("language-settings");
    const text = "This switch shows once the site has another language, in Site settings' Languages.";
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
  const shown = { display: props.display, label: props.label, className: props.className };
  if (!languages) return languageMap ? <LayoutLanguageList map={languageMap} {...shown} /> : null;
  return <LanguageList links={languages} {...shown} />;
}
