import { formTarget, type SiteSettings } from "@goodfellow-cms/core";
import { sectionId } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { AppLink } from "./use-link.js";

/** A service with a free plan the site can use, set up on a screen of Site Settings. */
interface FreeService {
  id: "forms" | "comments" | "stats";
  title: StringKey;
  text: StringKey;
  href: string;
  /** A section of the General tab, where the cards are, which its link scrolls to rather than leaving the screen. */
  section?: "forms";
}

/** The free services Site Settings' General tab offers as cards, in its order. */
export const FREE_SITE_SERVICES: readonly FreeService[] = [
  {
    id: "forms",
    title: "freeServices.forms",
    text: "freeServices.formsText",
    href: "#/settings/general?section=forms",
    section: "forms",
  },
  { id: "comments", title: "freeServices.comments", text: "freeServices.commentsText", href: "#/settings/comments" },
  { id: "stats", title: "freeServices.stats", text: "freeServices.statsText", href: "#/settings/stats" },
];

/** Whether the site has each free service set up, by its settings: forms only once a form could send. */
export function freeServicesSetUp(settings: SiteSettings): Record<FreeService["id"], boolean> {
  return {
    forms: !("problem" in formTarget(settings.forms)),
    comments: Boolean(settings.comments),
    stats: Boolean(settings.stats),
  };
}

/**
 * A card's link: to another screen through `AppLink`, which asks before
 * leaving unpublished changes, or, for a section of this screen, a scroll to
 * it, which keeps what's being edited and the question before leaving it.
 */
function ServiceLink({ service, label, children }: { service: FreeService; label: string; children: string }) {
  const { section } = service;
  if (!section) {
    return (
      <AppLink href={service.href} aria-label={label}>
        {children}
      </AppLink>
    );
  }
  return (
    <a
      href={service.href}
      aria-label={label}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        const heading = document.getElementById(sectionId(section));
        if (!heading) return;
        event.preventDefault();
        heading.scrollIntoView({ block: "start" });
        heading.focus();
      }}
    >
      {children}
    </a>
  );
}

/** Cards for the free services, each saying whether it's set up and linking to where it's set up. */
export function FreeServices({ settings }: { settings: SiteSettings }) {
  const t = useStrings();
  const setUp = freeServicesSetUp(settings);
  return (
    <section className="gfa-free-services" aria-labelledby="gfa-free-services-title">
      <h2 id="gfa-free-services-title" className="gfa-section-title">
        {t("freeServices.title")}
      </h2>
      <p className="gfa-hint">{t("freeServices.intro")}</p>
      <ul className="gfa-free-services-list">
        {FREE_SITE_SERVICES.map((service) => (
          <li key={service.id} className="gfa-free-services-card">
            <strong>{t(service.title)}</strong>
            <span className="gfa-hint">{t(service.text)}</span>
            <span className={setUp[service.id] ? "gfa-free-services-on" : "gfa-hint"}>
              {t(setUp[service.id] ? "freeServices.on" : "freeServices.off")}
            </span>
            <ServiceLink
              service={service}
              label={t(setUp[service.id] ? "freeServices.changeLabel" : "freeServices.setUpLabel", {
                service: t(service.title),
              })}
            >
              {t(setUp[service.id] ? "freeServices.change" : "freeServices.setUp")}
            </ServiceLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
