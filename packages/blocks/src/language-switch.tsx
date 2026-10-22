import { classNameField, cx, SiteLink, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { options } from "./options.js";

export interface LanguageSwitchProps {
  display: "links" | "menu";
  label: string;
  className: string;
}

/**
 * Links to the page in each of the site's languages: its translation, or the
 * language's home page where it has none. Each language is named in itself,
 * so visitors find their own. Plain links and `<details>`, with no JavaScript.
 */
export const LanguageSwitch: ComponentConfig<LanguageSwitchProps> = {
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
};

function LanguageSwitchView({ isEditing, ...stored }: Omit<LanguageSwitchProps, "id"> & { isEditing: boolean }) {
  const { languages, adminLink } = useSite();
  // Stored props can leave settings out, such as an AI assistant's answer.
  const given = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined));
  const props = { ...LanguageSwitch.defaultProps, ...given } as LanguageSwitchProps;
  if (!languages || languages.length < 2) {
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
  const current = languages.find((language) => language.current) ?? languages[0];
  const links = languages.map((language) => (
    <li key={language.code}>
      <SiteLink
        href={language.path}
        hrefLang={language.code}
        lang={language.code}
        aria-current={language.current ? "true" : undefined}
        className={cx(
          "block rounded-md px-2 py-1 text-sm hover:bg-muted",
          language.current ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {language.name}
      </SiteLink>
    </li>
  ));
  if (props.display === "menu") {
    return (
      <nav aria-label={props.label} className={cx("relative inline-block", props.className)}>
        <details className="group">
          <summary
            lang={current?.code}
            className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted [&::-webkit-details-marker]:hidden"
          >
            {current?.name}
            <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="absolute right-0 z-10 mt-1 min-w-40 rounded-md border border-border bg-background p-1 shadow-md">
            {links}
          </ul>
        </details>
      </nav>
    );
  }
  return (
    <nav aria-label={props.label} className={props.className || undefined}>
      <ul className="flex flex-wrap items-center gap-1">{links}</ul>
    </nav>
  );
}
