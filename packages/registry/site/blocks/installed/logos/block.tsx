import {
  classNameField,
  mediaField,
  SiteImage,
  SiteLink,
  useParts,
  withKeywords,
  withParts,
} from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

interface Logo {
  image: string;
  name: string;
  link: string;
}

export interface LogosProps {
  heading: string;
  logos: Logo[];
  size: "small" | "medium" | "large";
  /** Whether the logos are gray until the pointer is over them, so their colors don't clash with the site's. */
  gray: boolean;
  className: string;
}

const sizeClasses: Record<LogosProps["size"], string> = {
  small: "h-8",
  medium: "h-12",
  large: "h-16",
};

function LogosView({ heading, logos, size, gray, className, puck }: LogosProps & { puck?: { isEditing?: boolean } }) {
  const part = useParts();
  const shown = (logos ?? []).filter((logo) => logo.image);
  if (shown.length === 0) {
    // Only editors see why there's nothing; visitors see nothing.
    if (!puck?.isEditing) return null;
    return (
      <div className={part("gf-logos", "rounded-lg bg-muted p-6 text-center text-muted-foreground", className)}>
        Add logos from the media library.
      </div>
    );
  }
  const imageClass = part("gf-logos-image", [
    "w-auto max-w-40 object-contain",
    sizeClasses[size] ?? sizeClasses.medium,
    gray && "opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0",
  ]);
  return (
    <section className={part("gf-logos", "w-full", className)}>
      {heading && (
        <h2 className={part("gf-logos-heading", "mb-6 text-center font-heading text-2xl font-semibold")}>{heading}</h2>
      )}
      <ul className={part("gf-logos-list", "flex flex-wrap items-center justify-center gap-x-10 gap-y-6")}>
        {shown.map((logo, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same logo can be shown twice
          <li key={index} className={part("gf-logos-logo", "flex items-center")}>
            {logo.link ? (
              <SiteLink href={logo.link} className="inline-flex">
                <SiteImage src={logo.image} alt={logo.name} className={imageClass} />
              </SiteLink>
            ) : (
              <SiteImage src={logo.image} alt={logo.name} className={imageClass} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A row of logos, such as sponsors, partners or the organizations a site belongs to, each linking to its site. */
const Logos: ComponentConfig<LogosProps> = withParts(
  {
    label: "Logos",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      logos: {
        type: "array",
        label: "Logos",
        arrayFields: {
          image: mediaField("Logo"),
          name: { type: "text", label: "Whose logo it is, for screen readers" },
          link: { type: "text", label: "Links to (optional)" },
        },
        defaultItemProps: { image: "", name: "", link: "" },
        getItemSummary: (logo, index) => logo.name || `Logo ${(index ?? 0) + 1}`,
      },
      size: {
        type: "radio",
        label: "Size",
        options: [
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ],
      },
      gray: {
        type: "radio",
        label: "Colors",
        options: [
          { value: false, label: "The logos' own" },
          { value: true, label: "Gray until pointed at" },
        ],
      },
      className: classNameField,
    },
    defaultProps: { heading: "Our partners", logos: [], size: "medium", gray: false, className: "" },
    render: (props) => <LogosView {...props} />,
  },
  {
    "gf-logos": "Logos",
    "gf-logos-heading": "Heading",
    "gf-logos-list": "List",
    "gf-logos-logo": "Logo",
    "gf-logos-image": "Logo's picture",
  },
);

export default withKeywords(Logos, ["logos", "sponsors", "partners", "supporters", "clients", "members"]);
