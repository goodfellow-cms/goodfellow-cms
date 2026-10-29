import {
  CONSENT_ACCEPT_ATTRIBUTE,
  CONSENT_CHOICES_ATTRIBUTE,
  CONSENT_CHOOSE_ATTRIBUTE,
  CONSENT_DAYS_ATTRIBUTE,
  CONSENT_DECLINE_ATTRIBUTE,
  CONSENT_KIND_ATTRIBUTE,
  CONSENT_KINDS_ATTRIBUTE,
  CONSENT_MESSAGE_ID,
  CONSENT_NOTICE_ATTRIBUTE,
  CONSENT_NOTICE_ID,
  CONSENT_PLACEHOLDER_ATTRIBUTE,
  CONSENT_SAVE_ATTRIBUTE,
  CONSENT_SRC_ATTRIBUTE,
  type ConsentSettings,
  consentKinds,
  consentSource,
  isScriptUrl,
  withBase,
} from "@goodfellow-cms/core";
import type { IframeHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.js";
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
    // The consent script hides it, perhaps before Next.js's React takes over the page.
    <div className="gf-consent-placeholder" {...{ [CONSENT_PLACEHOLDER_ATTRIBUTE]: "" }} suppressHydrationWarning>
      <p>{consent.held.replaceAll("{site}", consentSource(src))}</p>
      {/* It allows other sites' content, and nothing else the site asks about. */}
      <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "content" }}>
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
   * parent (`relative`), or a box of its own with `box`. The box is there
   * wherever it's drawn, the editor included, and takes `boxClassName`, such
   * as the block's Style, since it's the block's outermost element. Its props keep their order.
   */
  function ConsentFrame({
    box,
    boxClassName,
    ...props
  }: IframeHTMLAttributes<HTMLIFrameElement> & { src: string; box?: boolean; boxClassName?: string }) {
    const consent = heldBack(useSite().settings);
    const boxed = (shown: ReactNode) => <div className={cx("gf-consent-box", boxClassName)}>{shown}</div>;
    if (!consent) return box ? boxed(<iframe {...props} />) : <iframe {...props} />;
    const held = Object.fromEntries(
      Object.entries(props).map(([name, value]) => [name === "src" ? CONSENT_SRC_ATTRIBUTE : name, value]),
    );
    const shown = (
      <>
        {/* The consent script gives it its address in place, perhaps before Next.js's React takes over the page. */}
        <iframe {...held} suppressHydrationWarning />
        <Placeholder consent={consent} src={props.src} />
      </>
    );
    return box ? boxed(shown) : shown;
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
        <script {...{ [CONSENT_SRC_ATTRIBUTE]: src }} suppressHydrationWarning />
        <div
          className="gf-consent-placeholder gf-consent-inline"
          {...{ [CONSENT_PLACEHOLDER_ATTRIBUTE]: "" }}
          suppressHydrationWarning
        >
          <p>{message ?? consent.held.replaceAll("{site}", consentSource(src))}</p>
          <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "content" }}>
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
 * Where the site asks about more than one kind (`consentKinds()`), Choose
 * shows a choice for each. Hidden as rendered, so visitors without
 * JavaScript, the admin panel's previews and search engines never see it.
 */
export function ConsentNotice({ site }: { site: SiteContextValue }) {
  const consent = site.settings.consent;
  if (!consent) return null;
  const kinds = consentKinds(consent);
  const choices = kinds.length > 1;
  return (
    <div
      id={CONSENT_NOTICE_ID}
      {...{
        [CONSENT_NOTICE_ATTRIBUTE]: "",
        [CONSENT_KINDS_ATTRIBUTE]: kinds.join(" "),
        [CONSENT_DAYS_ATTRIBUTE]: String(consent.days),
      }}
      className="gf-consent"
      role="dialog"
      aria-labelledby={CONSENT_MESSAGE_ID}
      hidden
      // The consent script shows it before Next.js's React takes over the page.
      suppressHydrationWarning
      data-pagefind-ignore=""
    >
      <p id={CONSENT_MESSAGE_ID}>
        {consent.message}
        {consent.policy && !isScriptUrl(consent.policy) && (
          <>
            {" "}
            <a href={withBase(consent.policy, site.base)}>{consent.policyLabel}</a>
          </>
        )}
      </p>
      {choices && (
        // The consent script shows the choices, and which are ticked, when the visitor asks for them.
        <fieldset
          className="gf-consent-choices"
          {...{ [CONSENT_CHOICES_ATTRIBUTE]: "" }}
          aria-label={consent.choose}
          hidden
          suppressHydrationWarning
        >
          {kinds.map((kind) => (
            <label key={kind}>
              <input type="checkbox" {...{ [CONSENT_KIND_ATTRIBUTE]: kind }} />
              {consent[kind]}
            </label>
          ))}
        </fieldset>
      )}
      <div className="gf-consent-buttons">
        <button type="button" {...{ [CONSENT_DECLINE_ATTRIBUTE]: "" }}>
          {consent.decline}
        </button>
        {choices && (
          <>
            <button type="button" {...{ [CONSENT_CHOOSE_ATTRIBUTE]: "" }} suppressHydrationWarning>
              {consent.choose}
            </button>
            <button type="button" {...{ [CONSENT_SAVE_ATTRIBUTE]: "" }} hidden suppressHydrationWarning>
              {consent.save}
            </button>
          </>
        )}
        <button type="button" {...{ [CONSENT_ACCEPT_ATTRIBUTE]: "" }}>
          {consent.accept}
        </button>
      </div>
    </div>
  );
}
