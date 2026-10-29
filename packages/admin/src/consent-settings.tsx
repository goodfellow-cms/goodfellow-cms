import { CONSENT_DEFAULTS, type ConsentSettings } from "@goodfellow-cms/core";
import { sectionId } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Field, TextField } from "./ui.js";

/** The consent notice's words, which each of the site's languages can have its own of. */
export const CONSENT_WORDS = ["message", "accept", "decline", "held", "show", "policyLabel"] as const;

export type ConsentWord = (typeof CONSENT_WORDS)[number];

/** Each word's label and hint in the string table. */
const WORD_STRINGS: Record<ConsentWord, { label: StringKey; hint?: StringKey }> = {
  message: { label: "consent.message" },
  accept: { label: "consent.accept" },
  decline: { label: "consent.decline" },
  held: { label: "consent.held", hint: "consent.heldHint" },
  show: { label: "consent.show" },
  policyLabel: { label: "consent.policyLabel" },
};

/** Consent settings without empty words or ones left as they come, which the defaults fill in, or `undefined` when off. */
export function cleanConsent(consent: ConsentSettings | undefined): Partial<ConsentSettings> | undefined {
  if (!consent) return undefined;
  const words = CONSENT_WORDS.flatMap((word) => {
    const value = consent[word]?.trim();
    return value && value !== CONSENT_DEFAULTS[word] ? [[word, value]] : [];
  });
  const policy = consent.policy?.trim();
  return { ...Object.fromEntries(words), ...(policy && { policy }) };
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

/** Whether pages ask visitors before loading other sites' content, and what the notice says. */
export function ConsentSection({
  consent,
  onChange,
}: {
  consent: ConsentSettings | undefined;
  onChange: (consent: ConsentSettings | undefined) => void;
}) {
  const t = useStrings();
  return (
    <>
      <h2 id={sectionId("consent")} className="gfa-section-title" tabIndex={-1}>
        {t("consent.title")}
      </h2>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={consent !== undefined}
          onChange={(event) => onChange(event.target.checked ? { ...CONSENT_DEFAULTS } : undefined)}
        />
        {t("consent.ask")}
      </label>
      <p className="gfa-hint">{t("consent.hint")}</p>
      {consent && (
        <>
          {CONSENT_WORDS.filter((word) => word !== "policyLabel").map((word) => (
            <ConsentWordField
              key={word}
              word={word}
              placeholder={CONSENT_DEFAULTS[word]}
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
            placeholder={CONSENT_DEFAULTS.policyLabel}
            value={consent.policyLabel}
            onChange={(policyLabel) => onChange({ ...consent, policyLabel })}
          />
        </>
      )}
    </>
  );
}
