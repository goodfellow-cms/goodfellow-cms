import {
  CONSENT_ACCEPT_ATTRIBUTE,
  CONSENT_DECLINE_ATTRIBUTE,
  CONSENT_NOTICE_ID,
  CONSENT_PLACEHOLDER_ATTRIBUTE,
  CONSENT_SRC_ATTRIBUTE,
  type ConsentSettings,
  consentSource,
  isScriptUrl,
  withBase,
} from "@goodfellow-cms/core";
import type { IframeHTMLAttributes } from "react";
import type { SiteContextValue } from "./site-types.js";

/**
 * Whether what comes from other sites waits for the visitor's agreement: on a
 * site that asks, in pages as they're built. The admin panel's editor and
 * previews, which render in the browser, show it at once.
 */
function heldBack(settings: SiteContextValue["settings"] | undefined): ConsentSettings | undefined {
  return typeof document === "undefined" ? settings?.consent : undefined;
}

/** What's shown in a held-back player's place: where it's from, and a button that agrees and shows it. */
function Placeholder({ consent, src }: { consent: ConsentSettings; src: string }) {
  return (
    <div className="gf-consent-placeholder" {...{ [CONSENT_PLACEHOLDER_ATTRIBUTE]: "" }}>
      <p>{consent.held.replaceAll("{site}", consentSource(src))}</p>
      <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "" }}>
        {consent.show}
      </button>
    </div>
  );
}

/** Builds the consent components on a `useSite()`: the browser's, or the Server Components' version. */
export function createConsent(useSite: () => SiteContextValue) {
  /**
   * A frame showing another site's page, such as a YouTube player or a Google
   * form. On a site that asks visitors first, it loads nothing until they
   * agree, with a note and a button in its place, which covers its positioned
   * parent (`relative`), or a box of its own with `box`. Its props keep their order.
   */
  function ConsentFrame({ box, ...props }: IframeHTMLAttributes<HTMLIFrameElement> & { src: string; box?: boolean }) {
    const consent = heldBack(useSite().settings);
    if (!consent) return <iframe {...props} />;
    const held = Object.fromEntries(
      Object.entries(props).map(([name, value]) => [name === "src" ? CONSENT_SRC_ATTRIBUTE : name, value]),
    );
    const shown = (
      <>
        <iframe {...held} />
        <Placeholder consent={consent} src={props.src} />
      </>
    );
    return box ? <div className="gf-consent-box">{shown}</div> : shown;
  }

  /**
   * Another site's script that a block needs, such as Web3Forms' hCaptcha. On a
   * site that asks visitors first, it loads once they agree, and until then
   * `message` says what it's for, with a button that agrees.
   */
  function ConsentScript({ src, message }: { src: string; message?: string }) {
    const consent = heldBack(useSite().settings);
    if (!consent) return <script src={src} async defer />;
    return (
      <>
        <script {...{ [CONSENT_SRC_ATTRIBUTE]: src }} />
        <div className="gf-consent-placeholder gf-consent-inline" {...{ [CONSENT_PLACEHOLDER_ATTRIBUTE]: "" }}>
          <p>{message ?? consent.held.replaceAll("{site}", consentSource(src))}</p>
          <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "" }}>
            {consent.show}
          </button>
        </div>
      </>
    );
  }

  return { ConsentFrame, ConsentScript };
}

/**
 * The notice asking visitors whether the site may load other sites' content,
 * in the page's language, which the consent script shows until they answer.
 * Hidden as rendered, so visitors without JavaScript, the admin panel's
 * previews and search engines never see it.
 */
export function ConsentNotice({ site }: { site: SiteContextValue }) {
  const consent = site.settings.consent;
  if (!consent) return null;
  return (
    <div
      id={CONSENT_NOTICE_ID}
      className="gf-consent"
      role="dialog"
      aria-label={consent.policyLabel}
      hidden
      // The consent script shows it before Next.js's React takes over the page.
      suppressHydrationWarning
      data-pagefind-ignore=""
    >
      <p>
        {consent.message}
        {consent.policy && !isScriptUrl(consent.policy) && (
          <>
            {" "}
            <a href={withBase(consent.policy, site.base)}>{consent.policyLabel}</a>
          </>
        )}
      </p>
      <div className="gf-consent-buttons">
        <button type="button" {...{ [CONSENT_DECLINE_ATTRIBUTE]: "" }}>
          {consent.decline}
        </button>
        <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "" }}>
          {consent.accept}
        </button>
      </div>
    </div>
  );
}
