import { formRedirect, WEB3FORMS_SCRIPT } from "@goodfellow-cms/core";
import {
  type AdminLinkProps,
  ConsentScript,
  classNameField,
  cx,
  useParts,
  useSite,
  withParts,
} from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import {
  NEWSLETTER_SERVICE_NAMES,
  type NewsletterProps,
  newsletterProblem,
  newsletterTarget,
} from "./newsletter-data.js";
import { options, yesNo } from "./options.js";
import { NEWSLETTER_PARTS } from "./parts.js";

export {
  NEWSLETTER_SERVICES,
  type NewsletterProps,
  type NewsletterService,
  newsletterTarget,
} from "./newsletter-data.js";

const INPUT_CLASSES =
  "block w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-2 focus:outline-offset-1 focus:outline-primary";

function Notice({ text, link }: { text: string; link?: AdminLinkProps }) {
  return (
    <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
      {link ? (
        <a {...link} className="underline underline-offset-2 hover:text-foreground">
          {text}
        </a>
      ) : (
        text
      )}
    </p>
  );
}

function NewsletterView({ isEditing, id, ...stored }: NewsletterProps & { isEditing: boolean; id: string }) {
  const { settings, adminLink } = useSite();
  const part = useParts();
  // Stored props can leave settings out, such as an AI assistant's answer.
  const given = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined));
  const props = { ...Newsletter.defaultProps, ...given } as NewsletterProps;
  const redirect = props.service === "forms" ? formRedirect(settings.url, props.thankYou) : undefined;
  const target = newsletterTarget(props, settings.forms, { from: settings.title, redirect });
  if ("problem" in target && !isEditing) return null;
  // Pages are rendered on the server, so a form rendered in the browser is the admin panel's, which never sends.
  const onSite = typeof document === "undefined";
  const row = props.layout !== "stacked";
  const centered = props.align === "center";
  const askName = props.askName && "name" in target && Boolean(target.name);
  const labelClass = part("gf-newsletter-label", row ? "sr-only" : "block font-medium");

  return (
    <div
      className={part(
        "gf-newsletter",
        cx("flex w-full flex-col gap-3", centered ? "items-center text-center" : "items-start"),
        props.className,
      )}
    >
      {isEditing && "problem" in target && (
        <Notice
          text={newsletterProblem(props.service, target.problem)}
          link={props.service === "forms" ? adminLink?.("forms-settings") : undefined}
        />
      )}
      {props.heading && (
        <h2 className={part("gf-newsletter-heading", "font-heading text-2xl font-semibold")}>{props.heading}</h2>
      )}
      {props.text && <p className={part("gf-newsletter-text", "max-w-prose text-muted-foreground")}>{props.text}</p>}
      <form
        className={part(
          "gf-newsletter-form",
          cx("flex w-full max-w-md gap-2 text-left", row ? "flex-col sm:flex-row sm:items-end" : "flex-col"),
        )}
        {...(onSite && "action" in target
          ? { action: target.action, method: "post" }
          : { onSubmit: (event: { preventDefault(): void }) => event.preventDefault() })}
      >
        {"hidden" in target &&
          target.hidden.map((field) => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
        {"honeypot" in target && target.honeypot && (
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
        {askName && "name" in target && (
          <div className={part("gf-newsletter-field", "flex-1 space-y-1.5")}>
            <label htmlFor={`${id}-name`} className={labelClass}>
              {props.nameLabel || "First name"}
            </label>
            <input
              id={`${id}-name`}
              name={target.name}
              type="text"
              autoComplete="given-name"
              placeholder={row ? props.nameLabel || "First name" : undefined}
              className={part("gf-newsletter-input", INPUT_CLASSES)}
            />
          </div>
        )}
        <div className={part("gf-newsletter-field", "flex-1 space-y-1.5")}>
          <label htmlFor={`${id}-email`} className={labelClass}>
            {props.emailLabel || "Email address"}
          </label>
          <input
            id={`${id}-email`}
            name={"email" in target ? target.email : "email"}
            type="email"
            required
            autoComplete="email"
            placeholder={row ? props.emailLabel || "Email address" : undefined}
            className={part("gf-newsletter-input", INPUT_CLASSES)}
          />
        </div>
        {"captcha" in target &&
          target.captcha &&
          (isEditing ? (
            <Notice text="Web3Forms' hCaptcha shows here on the site." />
          ) : (
            <>
              <div className="h-captcha" data-captcha="true" />
              {onSite && <ConsentScript src={WEB3FORMS_SCRIPT} />}
            </>
          ))}
        <button
          type="submit"
          className={part(
            "gf-newsletter-submit",
            "inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-primary px-5 font-medium text-primary-foreground transition hover:opacity-90",
          )}
        >
          {props.buttonLabel || "Subscribe"}
        </button>
      </form>
      {props.note && <p className={part("gf-newsletter-note", "text-sm text-muted-foreground")}>{props.note}</p>}
    </div>
  );
}

const newsletterFields: Fields<NewsletterProps> = {
  heading: { type: "text", label: "Heading", contentEditable: true },
  text: { type: "textarea", label: "Text", contentEditable: true },
  service: { type: "select", label: "Newsletter service", options: options(NEWSLETTER_SERVICE_NAMES) },
  form: { type: "textarea", label: "The service's signup form: its embed code or address" },
  askName: { type: "radio", label: "Ask for a first name too", options: yesNo },
  nameLabel: { type: "text", label: "First name's label" },
  emailLabel: { type: "text", label: "Email address's label" },
  buttonLabel: { type: "text", label: "Button's text", contentEditable: true },
  note: { type: "text", label: "Words under the form, such as how often it's sent", contentEditable: true },
  thankYou: {
    type: "text",
    label: "Page visitors see after signing up, such as /thank-you (without one, they see the form service's own)",
  },
  sentText: { type: "text", label: "In the site's app: what it says once someone has signed up" },
  failedText: { type: "text", label: "In the site's app: what it says when the signup couldn't be sent" },
  layout: {
    type: "radio",
    label: "Layout",
    options: options({ row: "Button beside the box", stacked: "Button under the box" }),
  },
  align: { type: "radio", label: "Alignment", options: options({ left: "Left", center: "Center" }) },
  className: classNameField,
};

/**
 * A newsletter signup: an email box that posts straight to Mailchimp,
 * Buttondown, Kit or the site's form service, so it works without
 * JavaScript and loads nothing from the service until someone signs up.
 */
export const Newsletter: ComponentConfig<NewsletterProps> = withParts(
  {
    label: "Newsletter signup",
    fields: newsletterFields,
    defaultProps: {
      heading: "Get our newsletter",
      text: "News and events, straight to your inbox.",
      service: "mailchimp",
      form: "",
      askName: false,
      nameLabel: "First name",
      emailLabel: "Email address",
      buttonLabel: "Subscribe",
      note: "",
      thankYou: "",
      sentText: "Thank you. You're signed up.",
      failedText: "You couldn't be signed up. Check your connection and try again.",
      layout: "row",
      align: "center",
      className: "",
    },
    resolveFields: ({ props }, { fields }) => {
      const resolved: Partial<Fields<NewsletterProps>> = { ...fields };
      const service = props.service ?? "mailchimp";
      // The site's form service is set up in Site Settings; the others mail their own thank-you pages.
      // Only the site's form service is sent by the app itself.
      if (service === "forms") delete resolved.form;
      else {
        delete resolved.thankYou;
        delete resolved.sentText;
        delete resolved.failedText;
      }
      if (service === "buttondown") delete resolved.askName;
      if (service === "buttondown" || !props.askName) delete resolved.nameLabel;
      if (service === "buttondown") {
        resolved.form = { type: "textarea", label: "Your Buttondown username, or its embed code" };
      }
      return resolved as Fields<NewsletterProps>;
    },
    render: ({ puck, id, ...props }) => <NewsletterView {...props} id={id} isEditing={puck.isEditing} />,
  },
  NEWSLETTER_PARTS,
);
