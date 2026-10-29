import {
  CONSENT_DAYS,
  CONSENT_KINDS,
  type ConsentSettings,
  consentDefaults,
  consentKinds,
  consentSchema,
  MAX_CONSENT_DAYS,
} from "@goodfellow-cms/core";
import { useState } from "react";
import { sectionId } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Field, TextField } from "./ui.js";

/** The consent notice's words, which each of the site's languages can have its own of. */
export const CONSENT_WORDS = [
  "message",
  "accept",
  "decline",
  "held",
  "show",
  "policyLabel",
  "choose",
  "save",
  ...CONSENT_KINDS,
] as const;

export type ConsentWord = (typeof CONSENT_WORDS)[number];

/** Each word's label and hint in the string table. */
const WORD_STRINGS: Record<ConsentWord, { label: StringKey; hint?: StringKey }> = {
  message: { label: "consent.message" },
  accept: { label: "consent.accept" },
  decline: { label: "consent.decline" },
  held: { label: "consent.held", hint: "consent.heldHint" },
  show: { label: "consent.show" },
  policyLabel: { label: "consent.policyLabel" },
  choose: { label: "consent.choose" },
  save: { label: "consent.save" },
  content: { label: "consent.kind.content" },
  statistics: { label: "consent.kind.statistics" },
  marketing: { label: "consent.kind.marketing" },
};

/**
 * The words the notice shows: the choices' only where the site asks about
 * more than one kind, since the code is for statistics or advertising, and
 * then each kind's it asks about.
 */
export function shownConsentWords(consent: ConsentSettings): ConsentWord[] {
  const kinds = consentKinds(consent);
  const choices = new Set<ConsentWord>(kinds.length > 1 ? ["choose", "save", ...kinds] : []);
  const choiceWords = new Set<ConsentWord>(["choose", "save", ...CONSENT_KINDS]);
  return CONSENT_WORDS.filter((word) => !choiceWords.has(word) || choices.has(word));
}

/**
 * Consent settings without empty words or ones left as they come in the
 * site's main language (`language`), which the defaults fill in, or `undefined` when off.
 */
export function cleanConsent(
  consent: ConsentSettings | undefined,
  language?: string,
): Partial<ConsentSettings> | undefined {
  if (!consent) return undefined;
  const defaults = consentDefaults(language);
  const words = CONSENT_WORDS.flatMap((word) => {
    const value = consent[word]?.trim();
    return value && value !== defaults[word] ? [[word, value]] : [];
  });
  const policy = consent.policy?.trim();
  const code = consent.code.head !== "content" || consent.code.body !== "content";
  return {
    ...Object.fromEntries(words),
    ...(policy && { policy }),
    ...(consent.days !== CONSENT_DAYS && { days: consent.days }),
    ...(code && { code: consent.code }),
  };
}

/** One of the notice's words, written in a text box or, for the notice's text, a bigger one. */
export function ConsentWordField({
  word,
  value,
  placeholder,
  onChange,
}: {
  word: ConsentWord;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const t = useStrings();
  const { label, hint } = WORD_STRINGS[word];
  if (word !== "message") {
    return (
      <TextField label={t(label)} hint={hint && t(hint)} placeholder={placeholder} value={value} onChange={onChange} />
    );
  }
  return (
    <Field label={t(label)}>
      {(props) => (
        <textarea
          {...props}
          className="gfa-input"
          rows={3}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * Whether pages ask visitors before loading other sites' content, and what the
 * notice says, its words coming in the site's main language (`language`).
 * Turned off and on again, it keeps the words written meanwhile.
 */
export function ConsentSection({
  consent,
  language,
  onChange,
}: {
  consent: ConsentSettings | undefined;
  language: string;
  onChange: (consent: ConsentSettings | undefined) => void;
}) {
  const t = useStrings();
  const defaults = consentDefaults(language);
  const [kept, setKept] = useState<ConsentSettings>();
  return (
    <>
      <h2 id={sectionId("consent")} className="gfa-section-title" tabIndex={-1}>
        {t("consent.title")}
      </h2>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={consent !== undefined}
          onChange={(event) => {
            if (event.target.checked) {
              onChange(kept ?? consentSchema.parse({ ...defaults }));
            } else {
              setKept(consent);
              onChange(undefined);
            }
          }}
        />
        {t("consent.ask")}
      </label>
      <p className="gfa-hint">{t("consent.hint")}</p>
      {consent && (
        <>
          {shownConsentWords(consent)
            .filter((word) => word !== "policyLabel")
            .map((word) => (
              <ConsentWordField
                key={word}
                word={word}
                placeholder={defaults[word]}
                value={consent[word]}
                onChange={(value) => onChange({ ...consent, [word]: value })}
              />
            ))}
          <TextField
            label={t("consent.policy")}
            hint={t("consent.policyHint")}
            placeholder="/privacy"
            value={consent.policy ?? ""}
            onChange={(policy) => onChange({ ...consent, policy })}
          />
          <ConsentWordField
            word="policyLabel"
            placeholder={defaults.policyLabel}
            value={consent.policyLabel}
            onChange={(policyLabel) => onChange({ ...consent, policyLabel })}
          />
          <Field label={t("consent.days")} hint={t("consent.daysHint")}>
            {(props) => (
              <input
                {...props}
                className="gfa-input"
                type="number"
                min={1}
                max={MAX_CONSENT_DAYS}
                value={consent.days}
                onChange={(event) => {
                  const days = Math.round(Number(event.target.value));
                  if (days >= 1) onChange({ ...consent, days: Math.min(days, MAX_CONSENT_DAYS) });
                }}
              />
            )}
          </Field>
        </>
      )}
    </>
  );
}
