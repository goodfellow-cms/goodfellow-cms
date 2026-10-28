// What the Form block asks and sends, with no React, so its web and native versions share it.

export type FormSource = "fields" | "google";

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
  source: FormSource;
  /** The form's name: the subject of the emails its answers arrive in, or a Google form's name for screen readers. */
  title: string;
  fields: FormField[];
  submitLabel: string;
  /** The page visitors see after sending, such as `/thank-you`. */
  thankYou: string;
  /**
   * What apps say once the answers are sent, where there's no thank-you
   * page, and when they couldn't be; the website shows the service's pages
   * instead. Stored forms may predate them.
   */
  sentText?: string;
  failedText?: string;
  /** A Google form's embed code or address. */
  google: string;
  /** A Google form's height in pixels, when its embed code doesn't say. */
  height: number;
  className: string;
}

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
