import { SiteImage, SiteLink } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import sponsorsFile from "../../.github/sponsors.json";
import { SPONSOR_PAGE } from "../scripts/sponsors-list.mjs";
import {
  anySponsors,
  cleanSponsors,
  type LogoSponsor,
  SPONSOR_CLASSES,
  SPONSORS_ATTRIBUTE,
  sponsorsScript,
} from "./sponsors-data";

interface SponsorsProps {
  heading: string;
  text: string;
}

function Logos({ sponsors, className }: { sponsors: LogoSponsor[]; className: string }) {
  return (
    <div className={SPONSOR_CLASSES.logos}>
      {sponsors.map((sponsor) => (
        <SiteLink key={sponsor.url} href={sponsor.url}>
          <SiteImage src={sponsor.logo} alt={sponsor.name} className={className} loading="lazy" />
        </SiteLink>
      ))}
    </div>
  );
}

/**
 * Goodfellow's sponsors, from `.github/sponsors.json`: the copy on `master`
 * when the site was built (the docs workflow puts it in place, whatever
 * release the rest comes from), brought up to date from `master` as the page
 * loads by `sponsorsScript()`. Hidden while nobody is listed.
 */
function SponsorsView({ heading, text }: SponsorsProps) {
  const list = cleanSponsors(sponsorsFile);
  return (
    <>
      <section
        className="gf-sponsors mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-16 text-center"
        hidden={!anySponsors(list)}
        {...{ [SPONSORS_ATTRIBUTE]: JSON.stringify(list) }}
        // The script may show it, and change its list, before anything else runs.
        suppressHydrationWarning
      >
        <h2 className="font-heading text-3xl font-bold">{heading}</h2>
        {text && (
          <p className="max-w-prose text-muted-foreground">
            {text} <SiteLink href={SPONSOR_PAGE}>Become a sponsor</SiteLink>.
          </p>
        )}
        <div className="flex flex-col items-center gap-6" data-gf-sponsors-list="" suppressHydrationWarning>
          {list.patrons.length > 0 && <Logos sponsors={list.patrons} className={SPONSOR_CLASSES.patron} />}
          {list.organizations.length > 0 && (
            <Logos sponsors={list.organizations} className={SPONSOR_CLASSES.organization} />
          )}
          {list.backers.length > 0 && (
            <ul className={SPONSOR_CLASSES.backers}>
              {list.backers.map((sponsor) => (
                <li key={sponsor.url}>
                  <SiteLink href={sponsor.url} className={SPONSOR_CLASSES.link}>
                    {sponsor.name}
                  </SiteLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the script is this site's own, with its settings' `<` escaped */}
      <script dangerouslySetInnerHTML={{ __html: sponsorsScript() }} />
    </>
  );
}

export const Sponsors: ComponentConfig<SponsorsProps> = {
  label: "Goodfellow's sponsors",
  fields: {
    heading: { type: "text", label: "Heading" },
    text: { type: "textarea", label: "Text" },
  },
  defaultProps: {
    heading: "Sponsors",
    text: "Thank you to everyone who sponsors Goodfellow.",
  },
  render: (props) => <SponsorsView {...props} />,
};
