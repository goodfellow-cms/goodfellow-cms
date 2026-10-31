import {
  ANNOUNCEMENT_ATTRIBUTE,
  ANNOUNCEMENT_CLOSE_ATTRIBUTE,
  announcementHideScript,
  changesOn,
  todayIn,
} from "@goodfellow-cms/core";
import { classNameField, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { announcementHash, announcementShown } from "./announcement-data.js";
import { options, yesNo } from "./options.js";
import { ANNOUNCEMENT_PARTS } from "./parts.js";

type AnnouncementColors = "primary" | "secondary" | "muted";

export interface AnnouncementBarProps {
  message: string;
  /** Where its link goes, if anywhere, and the link's words. */
  href: string;
  linkLabel: string;
  colors: AnnouncementColors;
  /** The first day it shows, and the last, as `2026-12-24`, in the site's time zone. */
  showFrom: string;
  hideAfter: string;
  /** Whether visitors can close it, until its message changes. */
  closable: boolean;
  closeLabel: string;
  className: string;
}

const colorClasses: Record<AnnouncementColors, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-foreground",
};

function AnnouncementBarView({
  message,
  href,
  linkLabel,
  colors = "primary",
  showFrom,
  hideAfter,
  closable,
  closeLabel = "Close",
  className,
  isEditing,
}: AnnouncementBarProps & { isEditing: boolean }) {
  const part = useParts();
  const { settings } = useSite();
  const text = message?.trim() ?? "";
  if (!text) return null;
  const { shown, changes } = announcementShown({ showFrom, hideAfter }, todayIn(settings.timeZone));
  // Builds leave it out outside its days, and are built again the day that changes.
  if (!isEditing && typeof document === "undefined") changesOn(changes);
  if (!shown && !isEditing) return null;
  // Where pages are built, a closable bar comes after the script that hides it for visitors who closed it.
  const hides = closable && !isEditing && typeof document === "undefined";
  return (
    <>
      {hides && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Goodfellow's own script, which hides bars a visitor closed
        <script dangerouslySetInnerHTML={{ __html: announcementHideScript() }} />
      )}
      <section
        aria-label={text}
        className={part(
          "gf-announcement",
          "flex w-full items-center justify-center gap-3 px-4 py-2 text-center text-sm",
          colorClasses[colors] ?? colorClasses.primary,
          !shown ? "opacity-50" : "",
          className,
        )}
        {...(closable && { [ANNOUNCEMENT_ATTRIBUTE]: announcementHash(text, href ?? "") })}
      >
        <p className={part("gf-announcement-message", "m-0")}>
          {text}
          {href?.trim() && linkLabel?.trim() && (
            <>
              {" "}
              <SiteLink href={href.trim()} className={part("gf-announcement-link", "font-semibold underline")}>
                {linkLabel.trim()}
              </SiteLink>
            </>
          )}
        </p>
        {closable && (
          <button
            type="button"
            aria-label={closeLabel}
            className={part(
              "gf-announcement-close",
              "ml-2 shrink-0 rounded px-1 text-lg leading-none opacity-80 hover:opacity-100",
            )}
            {...{ [ANNOUNCEMENT_CLOSE_ATTRIBUTE]: "" }}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </section>
    </>
  );
}

/**
 * A bar across the page with a short message and a link, for news every
 * page should carry, such as a change of Mass times: put it at the top of
 * the header. It shows only between its first and last days, which builds
 * keep to, and visitors can close it until its message changes, which a
 * small script remembers (`announcementScript()`), and hides before the page
 * shows (`announcementHideScript()`, which it renders just before itself). The editor shows it outside its days
 * too, faded.
 */
export const AnnouncementBar: ComponentConfig<AnnouncementBarProps> = withParts(
  {
    label: "Announcement bar",
    fields: {
      message: { type: "text", label: "Message", contentEditable: true },
      href: { type: "text", label: "Link to (optional)" },
      linkLabel: { type: "text", label: "Link's words" },
      colors: {
        type: "radio",
        label: "Colors",
        options: options({ primary: "Main color", secondary: "Second color", muted: "Soft" }),
      },
      showFrom: { type: "text", label: "First day it shows (such as 2026-12-24; empty for now)" },
      hideAfter: { type: "text", label: "Last day it shows (such as 2027-01-06; empty for no end)" },
      closable: { type: "radio", label: "Visitors can close it", options: yesNo },
      closeLabel: { type: "text", label: "Close button's name, for screen readers" },
      className: classNameField,
    },
    defaultProps: {
      message: "Something everyone should know",
      href: "",
      linkLabel: "",
      colors: "primary",
      showFrom: "",
      hideAfter: "",
      closable: false,
      closeLabel: "Close",
      className: "",
    },
    render: ({ puck, ...props }) => <AnnouncementBarView {...props} isEditing={puck?.isEditing === true} />,
  },
  ANNOUNCEMENT_PARTS,
);
