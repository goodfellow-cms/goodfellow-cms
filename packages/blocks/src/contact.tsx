import { classNameField, cx, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { options, yesNo } from "./options.js";
import { CONTACT_PARTS } from "./parts.js";

export interface ContactDetailsProps {
  address: boolean;
  phone: boolean;
  email: boolean;
  layout: "stacked" | "inline";
  className: string;
}

/** A phone number as a `tel:` link: digits and a leading plus only. */
function phoneHref(phone: string): string {
  return `tel:${phone.replace(/(?!^\+)[^\d]/g, "")}`;
}

/** The site's contact details (from Site Settings), so they're kept in one place however often they're shown. */
function ContactDetailsView({
  address,
  phone,
  email,
  layout,
  className,
  isEditing,
}: ContactDetailsProps & { isEditing: boolean }) {
  const { settings, adminLink } = useSite();
  const part = useParts();
  const contact = settings.contact ?? {};
  const items = [
    address && contact.address && (
      <address key="address" className={part("gf-contact-address", "whitespace-pre-line not-italic")}>
        {contact.address}
      </address>
    ),
    phone && contact.phone && (
      <a key="phone" href={phoneHref(contact.phone)} className={part("gf-contact-phone", "hover:underline")}>
        {contact.phone}
      </a>
    ),
    email && contact.email && (
      <a key="email" href={`mailto:${contact.email}`} className={part("gf-contact-email", "hover:underline")}>
        {contact.email}
      </a>
    ),
  ].filter(Boolean);

  if (items.length === 0) {
    return isEditing ? (
      <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>
        {adminLink ? (
          <a {...adminLink("contact-settings")} className="underline underline-offset-2 hover:text-foreground">
            Add contact details in Site Settings.
          </a>
        ) : (
          "Add contact details in Site Settings."
        )}
      </p>
    ) : null;
  }

  return (
    <div
      className={part(
        "gf-contact",
        "flex",
        layout === "inline" ? "flex-wrap gap-x-6 gap-y-2" : "flex-col gap-2",
        className,
      )}
    >
      {items}
    </div>
  );
}

export const ContactDetails: ComponentConfig<ContactDetailsProps> = withParts(
  {
    label: "Contact details",
    fields: {
      address: { type: "radio", label: "Show the address", options: yesNo },
      phone: { type: "radio", label: "Show the phone number", options: yesNo },
      email: { type: "radio", label: "Show the email address", options: yesNo },
      layout: { type: "radio", label: "Layout", options: options({ stacked: "Down", inline: "Across" }) },
      className: classNameField,
    },
    defaultProps: { address: true, phone: true, email: true, layout: "stacked", className: "" },
    render: ({ puck, ...props }) => <ContactDetailsView {...props} isEditing={puck.isEditing} />,
  },
  CONTACT_PARTS,
);
