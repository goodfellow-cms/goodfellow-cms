import { GOODFELLOW_VERSION, structuredDataScript } from "@goodfellow-cms/core";
import { useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

const REPOSITORY = "https://github.com/goodfellow-cms/goodfellow-cms";

/**
 * Tells search engines what Goodfellow is, as schema.org's
 * `SoftwareApplication`, from the site's settings. It shows nothing: it's
 * structured data only, for the home page, beside the `WebSite` and
 * `Organization` every site's home page has. Its name is the site's title,
 * "Goodfellow CMS", and "Goodfellow" is the name people use day to day.
 */
function SoftwareDetailsView() {
  const { settings } = useSite();
  const url = settings.url ? `${settings.url.replace(/\/$/, "")}/` : undefined;
  const image = url && settings.socialImage ? new URL(settings.socialImage.replace(/^\//, ""), url).href : undefined;
  const script = structuredDataScript([
    {
      "@type": "SoftwareApplication",
      name: settings.title,
      alternateName: "Goodfellow",
      description: settings.description,
      ...(url && { url }),
      ...(image && { image }),
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Content management system",
      operatingSystem: "Any, in a web browser",
      softwareVersion: GOODFELLOW_VERSION,
      license: `${REPOSITORY}/blob/master/LICENSE`,
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      sameAs: [REPOSITORY, "https://www.npmjs.com/org/goodfellow-cms"],
    },
  ]);
  return script ? (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: structuredDataScript() escapes `<`, so nothing can end the script
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: script }} />
  ) : null;
}

export const SoftwareDetails: ComponentConfig = {
  label: "Software details for search engines",
  fields: {},
  render: () => <SoftwareDetailsView />,
};
