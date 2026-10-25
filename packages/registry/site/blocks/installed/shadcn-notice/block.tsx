import { classNameField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, RichText } from "@puckeditor/core";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Kind = "info" | "warning" | "success" | "urgent";

export interface NoticeProps {
  kind: Kind;
  title: string;
  text: RichText;
  className: string;
}

const icons = { info: InfoIcon, warning: TriangleAlertIcon, success: CircleCheckIcon, urgent: TriangleAlertIcon };

/** A short message that stands out, such as a closure or a change of times. */
const Notice: ComponentConfig<NoticeProps> = withParts(
  {
    label: "Notice",
    fields: {
      kind: {
        type: "select",
        label: "Kind",
        options: [
          { label: "Information", value: "info" },
          { label: "Warning", value: "warning" },
          { label: "Good news", value: "success" },
          { label: "Urgent", value: "urgent" },
        ],
      },
      title: { type: "text", label: "Heading", contentEditable: true },
      text: { type: "richtext", label: "Text", contentEditable: true },
      className: classNameField,
    },
    defaultProps: { kind: "info", title: "Please note", text: "<p>Say what's changed.</p>", className: "" },
    render: ({ kind, title, text, className }) => {
      const part = useParts();
      const Icon = icons[kind];
      return (
        <div className={part("gf-shadcn-notice", "mx-auto w-full max-w-3xl px-4 py-4", className)}>
          <Alert variant={kind === "urgent" ? "destructive" : "default"} className={part("gf-shadcn-notice-box")}>
            <Icon aria-hidden="true" />
            {title && <AlertTitle className={part("gf-shadcn-notice-title")}>{title}</AlertTitle>}
            <AlertDescription>
              <div className={part("gf-shadcn-notice-text", "gf-prose")}>{text}</div>
            </AlertDescription>
          </Alert>
        </div>
      );
    },
  },
  {
    "gf-shadcn-notice": "Notice",
    "gf-shadcn-notice-box": "Notice's box",
    "gf-shadcn-notice-title": "Notice's title",
    "gf-shadcn-notice-text": "Notice's text",
  },
);

export default Notice;
