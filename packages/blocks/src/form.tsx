import {
  type FormProblem,
  type FormTarget,
  formRedirect,
  formTarget,
  type GoogleFormProblem,
  googleFormUrl,
  WEB3FORMS_SCRIPT,
} from "@goodfellow-cms/core";
import { type AdminPlace, classNameField, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import type { ReactNode } from "react";
import { options, yesNo } from "./options.js";
import { FORM_PARTS } from "./parts.js";

type Source = "fields" | "google";

export type FormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "checkboxes"
  | "checkbox";

/** One question on a form. */
export interface FormField {
  label: string;
  type: FormFieldType;
  required: boolean;
  /** For lists and choices: one choice on each line. */
  choices: string;
  hint: string;
}

export interface FormProps {
  source: Source;
  /** The form's name: the subject of the emails its answers arrive in, or a Google form's name for screen readers. */
  title: string;
  fields: FormField[];
  submitLabel: string;
  /** The page visitors see after sending, such as `/thank-you`. */
  thankYou: string;
  /** A Google form's embed code or address. */
  google: string;
  /** A Google form's height in pixels, when its embed code doesn't say. */
  height: number;
  className: string;
}

const fieldTypeLabels: Record<FormFieldType, string> = {
  text: "Short answer",
  textarea: "Long answer",
  email: "Email address",
  phone: "Phone number",
  number: "Number",
  date: "Date",
  select: "A list to choose one from",
  radio: "One of several choices",
  checkboxes: "Any of several choices",
  checkbox: "A box to tick",
};

const inputTypes: Partial<Record<FormFieldType, string>> = {
  text: "text",
  email: "email",
  phone: "tel",
  number: "number",
  date: "date",
};

const autoComplete: Partial<Record<FormFieldType, string>> = { email: "email", phone: "tel" };

/** Names the services use themselves, which an answer mustn't take. */
const RESERVED = new Set([
  "access_key",
  "subject",
  "from_name",
  "redirect",
  "botcheck",
  "replyto",
  "ccemail",
  "webhook",
  "h-captcha-response",
]);

/** Google Forms gets what a form needs: its scripts, sending, and links that open in a new tab. */
const GOOGLE_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

const targetProblems: Record<FormProblem, string> = {
  "no-key": "Answers can't be sent yet: add Web3Forms' access key in Site Settings, under Forms.",
  "bad-key":
    "The Web3Forms access key in Site Settings isn't one. Copy it from the email Web3Forms sent: it looks like 0b5c4f7e-1a2b-4c3d-8e9f-0123456789ab.",
  "no-address": "Answers can't be sent yet: add the form's address in Site Settings, under Forms.",
  "bad-address":
    "The form address in Site Settings can't be used. Copy it from the form service: it starts with https://.",
};

const googleProblems: Record<GoogleFormProblem, string> = {
  "short-link":
    "Short forms.gle links can't be shown. In Google Forms, choose Send, then the <> tab, and paste the embed code instead.",
  "not-a-form":
    "Paste the Google form's embed code: in Google Forms, choose Send, then the <> tab, and copy the code there.",
};

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">{children}</p>;
}

/** Each question's name in the answers: its label, with the first email address as `email`, which services reply to. */
export function answerNames(fields: FormField[]): string[] {
  const used = new Set<string>();
  let email = false;
  return fields.map((field, index) => {
    let base = (field.label ?? "").trim().replace(/^_+/, "") || `Question ${index + 1}`;
    if (field.type === "email" && !email) {
      email = true;
      base = "email";
    } else if (RESERVED.has(base.toLowerCase()) || base.toLowerCase() === "email") {
      base = `${base} (answer)`;
    }
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** A list's choices, one on each line. */
export function choicesOf(field: FormField): string[] {
  return [
    ...new Set(
      (field.choices ?? "")
        .split("\n")
        .map((choice) => choice.trim())
        .filter(Boolean),
    ),
  ];
}

const INPUT_CLASSES =
  "block w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-2 focus:outline-offset-1 focus:outline-primary";

function Required() {
  const part = useParts();
  return (
    <span aria-hidden="true" className={part("gf-form-required", "text-muted-foreground")}>
      {" "}
      *
    </span>
  );
}

function Question({ field, name, id }: { field: FormField; name: string; id: string }) {
  const part = useParts();
  const inputClass = part("gf-form-input", INPUT_CLASSES);
  const choiceClass = part("gf-form-choice", "flex items-start gap-2");
  const checkClass = part("gf-form-check", "mt-1 size-4 accent-primary");
  const hintId = field.hint ? `${id}-hint` : undefined;
  const hint = field.hint && (
    <p id={hintId} className={part("gf-form-hint", "text-sm text-muted-foreground")}>
      {field.hint}
    </p>
  );
  const label = (field.label ?? "").trim() || name;
  const choices = choicesOf(field);

  if (field.type === "checkbox") {
    return (
      <div className={part("gf-form-question", "space-y-1")}>
        <label className={choiceClass}>
          <input
            type="checkbox"
            name={name}
            value="Yes"
            required={field.required}
            aria-describedby={hintId}
            className={checkClass}
          />
          <span>
            {label}
            {field.required && <Required />}
          </span>
        </label>
        {hint}
      </div>
    );
  }

  if (field.type === "radio" || field.type === "checkboxes") {
    return (
      <fieldset className={part("gf-form-question", "space-y-2")} aria-describedby={hintId}>
        <legend className={part("gf-form-label", "font-medium")}>
          {label}
          {field.required && field.type === "radio" && <Required />}
        </legend>
        {hint}
        {choices.map((choice) =>
          field.type === "radio" ? (
            <label key={choice} className={choiceClass}>
              <input type="radio" name={name} value={choice} required={field.required} className={checkClass} />
              <span>{choice}</span>
            </label>
          ) : (
            <label key={choice} className={choiceClass}>
              {/* Each choice is its own answer, which every service shows the same way. */}
              <input type="checkbox" name={`${name}: ${choice}`} value="Yes" className={checkClass} />
              <span>{choice}</span>
            </label>
          ),
        )}
      </fieldset>
    );
  }

  let control: ReactNode;
  if (field.type === "textarea") {
    control = (
      <textarea
        id={id}
        name={name}
        rows={5}
        required={field.required}
        aria-describedby={hintId}
        className={inputClass}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        id={id}
        name={name}
        required={field.required}
        aria-describedby={hintId}
        defaultValue=""
        className={inputClass}
      >
        <option value="" disabled={field.required}>
          —
        </option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        name={name}
        type={inputTypes[field.type] ?? "text"}
        required={field.required}
        autoComplete={autoComplete[field.type]}
        aria-describedby={hintId}
        className={inputClass}
      />
    );
  }

  return (
    <div className={part("gf-form-question", "space-y-1.5")}>
      <label htmlFor={id} className={part("gf-form-label", "block font-medium")}>
        {label}
        {field.required && <Required />}
      </label>
      {hint}
      {control}
    </div>
  );
}

/** A note for the editor, linked to where in the admin panel it's fixed. */
interface FormNotice {
  text: string;
  place?: AdminPlace;
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

/** Where visitors go after sending, or why they'll see the service's own page instead. */
function thankYouNotice(target: FormTarget, thankYou: string, siteUrl: string | undefined): FormNotice | undefined {
  if (!thankYou.trim()) return undefined;
  if (!target.redirects) {
    return {
      text: "Formspree sends visitors to a thank-you page of your own only on its paid plans, where it's set in Formspree's settings for the form. Until then, visitors see Formspree's own.",
    };
  }
  const redirect = formRedirect(siteUrl, thankYou);
  if (!redirect) {
    return thankYou.trim().startsWith("/")
      ? {
          text: "Visitors will see the form service's own thank-you page until the Site address is set in Site Settings.",
          place: "settings",
        }
      : {
          text: "The thank-you page must be one of the site's pages, such as /thank-you, or a full address starting with https://.",
        };
  }
  // Web3Forms' free plan sends visitors back only to the site the form is on.
  if (target.service === "web3forms" && hostOf(redirect) !== hostOf(siteUrl)) {
    return {
      text: "Web3Forms sends visitors to a page on another site only on its paid plans. Until then, visitors see Web3Forms' own thank-you page.",
    };
  }
  return undefined;
}

function FormView({ isEditing, id, ...stored }: FormProps & { isEditing: boolean; id: string }) {
  const { settings, adminLink } = useSite();
  const part = useParts();
  // Stored props can leave settings out, such as an AI assistant's answer.
  const given = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined));
  const props = { ...Form.defaultProps, ...given, fields: stored.fields ?? [] } as FormProps;
  const { className } = props;

  if (props.source === "google") {
    const form = googleFormUrl(props.google);
    if ("problem" in form) return isEditing ? <Notice>{googleProblems[form.problem]}</Notice> : null;
    return (
      <iframe
        className={part("gf-form-embed", "block w-full rounded-lg border-0", className)}
        style={{ height: form.height ?? props.height }}
        src={form.url}
        title={props.title || "Form"}
        loading="lazy"
        sandbox={GOOGLE_SANDBOX}
      />
    );
  }

  const redirect = formRedirect(settings.url, props.thankYou);
  const target = formTarget(settings.forms, {
    subject: props.title.trim() || undefined,
    from: settings.title,
    redirect,
  });
  if ("problem" in target && !isEditing) return null;
  // Pages are rendered on the server, so a form rendered in the browser is the admin panel's: it never sends
  // answers, and never loads Web3Forms' script where it could reach the editor's sign-in.
  const onSite = typeof document === "undefined";
  const names = answerNames(props.fields);
  const notices = [
    "problem" in target
      ? { text: targetProblems[target.problem], place: "forms-settings" as const }
      : thankYouNotice(target, props.thankYou, settings.url),
    props.fields.length === 0 ? { text: "Add the form's questions." } : undefined,
  ].filter((notice): notice is FormNotice => notice !== undefined);

  return (
    <div className={part("gf-form", "w-full max-w-xl space-y-4", className)}>
      {isEditing &&
        notices.map((notice) => {
          // In the editor, a note links to where it's fixed.
          const link = notice.place && adminLink?.(notice.place);
          return (
            <Notice key={notice.text}>
              {link ? (
                <a {...link} className="underline underline-offset-2 hover:text-foreground">
                  {notice.text}
                </a>
              ) : (
                notice.text
              )}
            </Notice>
          );
        })}
      <form
        className={part("gf-form-questions", "space-y-5")}
        {...(onSite && "action" in target
          ? { action: target.action, method: "post" }
          : { onSubmit: (event: { preventDefault(): void }) => event.preventDefault() })}
      >
        {"hidden" in target &&
          target.hidden.map((field) => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
        {"honeypot" in target && (
          // Hidden from people, so only bots fill it in.
          <input
            type={target.honeypot.type}
            name={target.honeypot.name}
            className="hidden"
            style={{ display: "none" }}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        )}
        {props.fields.map((field, index) => (
          <Question key={names[index]} field={field} name={names[index] ?? ""} id={`${id}-${index}`} />
        ))}
        {"captcha" in target &&
          target.captcha &&
          (isEditing ? (
            <Notice>Web3Forms' hCaptcha shows here on the site.</Notice>
          ) : (
            <>
              <div className="h-captcha" data-captcha="true" />
              {onSite && <script src={WEB3FORMS_SCRIPT} async defer />}
            </>
          ))}
        <button
          type="submit"
          className={part(
            "gf-form-submit",
            "inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 font-medium text-primary-foreground transition hover:opacity-90",
          )}
        >
          {props.submitLabel || "Send"}
        </button>
      </form>
    </div>
  );
}

const formFields: Fields<FormProps> = {
  source: {
    type: "radio",
    label: "Questions",
    options: options({ fields: "Set here", google: "A Google form" }),
  },
  title: { type: "text", label: "The form's name, as the subject of the emails its answers arrive in" },
  fields: {
    type: "array",
    label: "Questions",
    arrayFields: {
      label: { type: "text", label: "Question" },
      type: { type: "select", label: "Answer", options: options(fieldTypeLabels) },
      required: { type: "radio", label: "Must be answered", options: yesNo },
      choices: { type: "textarea", label: "Choices, one on each line (for lists and choices)" },
      hint: { type: "text", label: "Help text shown under the question" },
    },
    defaultItemProps: { label: "A question", type: "text", required: false, choices: "", hint: "" },
    getItemSummary: (item) => item.label || "Question",
  },
  submitLabel: { type: "text", label: "Button label" },
  thankYou: {
    type: "text",
    label: "Page visitors see after sending, such as /thank-you (without one, they see the form service's own)",
  },
  google: {
    type: "textarea",
    label: "The Google form's embed code (in Google Forms: Send, then the <> tab)",
  },
  height: { type: "number", label: "Height in pixels", min: 200 },
  className: classNameField,
};

/**
 * A form. Its answers go to the form service chosen in Site Settings, by a
 * plain form post, so it works without JavaScript; or a Google form.
 */
export const Form: ComponentConfig<FormProps> = withParts(
  {
    label: "Form",
    fields: formFields,
    defaultProps: {
      source: "fields",
      title: "Contact form",
      fields: [
        { label: "Name", type: "text", required: true, choices: "", hint: "" },
        { label: "Email", type: "email", required: true, choices: "", hint: "" },
        { label: "Message", type: "textarea", required: true, choices: "", hint: "" },
      ],
      submitLabel: "Send",
      thankYou: "",
      google: "",
      height: 800,
      className: "",
    },
    resolveFields: ({ props }, { fields }) => {
      const resolved: Partial<Fields<FormProps>> = { ...fields };
      if (props.source === "google") {
        delete resolved.fields;
        delete resolved.submitLabel;
        delete resolved.thankYou;
        resolved.title = { type: "text", label: "The form's name, for screen readers" };
        // The embed code says how tall the form is.
        const form = googleFormUrl(props.google ?? "");
        if ("height" in form && form.height) delete resolved.height;
      } else {
        delete resolved.google;
        delete resolved.height;
      }
      return resolved as Fields<FormProps>;
    },
    render: ({ puck, id, ...props }) => <FormView {...props} id={id} isEditing={puck.isEditing} />,
  },
  FORM_PARTS,
);
