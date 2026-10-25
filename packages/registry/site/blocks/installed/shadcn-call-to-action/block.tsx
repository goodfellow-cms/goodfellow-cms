import { classNameField, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Style = "highlight" | "subtle";

export interface CallToActionProps {
  title: string;
  text: string;
  buttonLabel: string;
  buttonLink: string;
  style: Style;
  className: string;
}

/** A highlighted box asking visitors to do something, with a button. */
const CallToAction: ComponentConfig<CallToActionProps> = withParts(
  {
    label: "Call to action",
    fields: {
      title: { type: "text", label: "Heading", contentEditable: true },
      text: { type: "textarea", label: "Text", contentEditable: true },
      buttonLabel: { type: "text", label: "Button" },
      buttonLink: { type: "text", label: "Button links to" },
      style: {
        type: "radio",
        label: "Style",
        options: [
          { label: "In the main color", value: "highlight" },
          { label: "Subtle", value: "subtle" },
        ],
      },
      className: classNameField,
    },
    defaultProps: {
      title: "Ready to get started?",
      text: "Tell visitors what to do next.",
      buttonLabel: "Get in touch",
      buttonLink: "/contact",
      style: "highlight",
      className: "",
    },
    render: ({ title, text, buttonLabel, buttonLink, style, className }) => {
      const part = useParts();
      const highlight = style === "highlight";
      return (
        <section className={part("gf-shadcn-call-to-action", "mx-auto w-full max-w-5xl px-4 py-12", className)}>
          <Card
            className={part("gf-shadcn-call-to-action-box", [
              "border-0",
              highlight ? "bg-primary text-primary-foreground" : "bg-muted",
            ])}
          >
            <CardContent className="flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between md:p-12">
              <div className="flex flex-col gap-2">
                <h2
                  className={part("gf-shadcn-call-to-action-heading", "text-2xl font-bold tracking-tight md:text-3xl")}
                >
                  {title}
                </h2>
                {text && (
                  <p
                    className={part("gf-shadcn-call-to-action-text", [
                      "text-lg",
                      highlight ? "opacity-90" : "text-muted-foreground",
                    ])}
                  >
                    {text}
                  </p>
                )}
              </div>
              {buttonLabel && (
                <SiteLink
                  href={buttonLink || "/"}
                  className={part(
                    "gf-shadcn-call-to-action-button",
                    buttonVariants({ size: "lg", variant: highlight ? "secondary" : "default" }),
                  )}
                >
                  {buttonLabel}
                </SiteLink>
              )}
            </CardContent>
          </Card>
        </section>
      );
    },
  },
  {
    "gf-shadcn-call-to-action": "Call to action",
    "gf-shadcn-call-to-action-box": "Box",
    "gf-shadcn-call-to-action-heading": "Heading",
    "gf-shadcn-call-to-action-text": "Text",
    "gf-shadcn-call-to-action-button": "Button",
  },
);

export default CallToAction;
