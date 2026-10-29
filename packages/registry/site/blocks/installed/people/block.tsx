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

interface Person {
  photo: string;
  name: string;
  role: string;
  bio: string;
  email: string;
  link: string;
}

export interface PeopleProps {
  heading: string;
  people: Person[];
  columns: "2" | "3" | "4";
  photos: "round" | "square";
  className: string;
}

const columnClasses: Record<PeopleProps["columns"], string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};

const photoClasses: Record<PeopleProps["photos"], string> = {
  round: "rounded-full",
  square: "rounded-lg",
};

/** The people of an organization, such as its staff or council: each with a photo, their name, role and a few words. */
const People: ComponentConfig<PeopleProps> = withParts(
  {
    label: "People",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      people: {
        type: "array",
        label: "People",
        arrayFields: {
          photo: mediaField("Photo"),
          name: { type: "text", label: "Name" },
          role: { type: "text", label: "Role, such as Parish secretary" },
          bio: { type: "textarea", label: "A few words about them" },
          email: { type: "text", label: "Email address (optional)" },
          link: { type: "text", label: "Links to, such as their page (optional)" },
        },
        defaultItemProps: { photo: "", name: "Name", role: "Role", bio: "", email: "", link: "" },
        getItemSummary: (person) => person.name || "Person",
      },
      columns: {
        type: "radio",
        label: "Across the page",
        options: [
          { value: "2", label: "2" },
          { value: "3", label: "3" },
          { value: "4", label: "4" },
        ],
      },
      photos: {
        type: "radio",
        label: "Photos",
        options: [
          { value: "round", label: "Round" },
          { value: "square", label: "Square" },
        ],
      },
      className: classNameField,
    },
    defaultProps: {
      heading: "Our team",
      people: [
        { photo: "", name: "Name", role: "Role", bio: "", email: "", link: "" },
        { photo: "", name: "Name", role: "Role", bio: "", email: "", link: "" },
        { photo: "", name: "Name", role: "Role", bio: "", email: "", link: "" },
      ],
      columns: "3",
      photos: "round",
      className: "",
    },
    render: ({ heading, people, columns, photos, className }) => {
      const part = useParts();
      // A person's name is a heading one level under the block's, or level 2 without one.
      const Name = heading ? "h3" : "h2";
      return (
        <section className={part("gf-people", "w-full", className)}>
          {heading && (
            <h2 className={part("gf-people-heading", "mb-8 text-center font-heading text-3xl font-semibold")}>
              {heading}
            </h2>
          )}
          <ul className={part("gf-people-list", ["grid gap-8", columnClasses[columns] ?? columnClasses["3"]])}>
            {(people ?? []).map((person, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: people can share a name
                key={index}
                className={part("gf-people-person", "flex flex-col items-center gap-2 text-center")}
              >
                {person.photo ? (
                  // The name is under it, so the photo needs no words of its own.
                  <SiteImage
                    src={person.photo}
                    alt=""
                    aria-hidden="true"
                    className={part("gf-people-photo", [
                      "mb-2 size-32 object-cover",
                      photoClasses[photos] ?? photoClasses.round,
                    ])}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className={part("gf-people-photo", [
                      "mb-2 size-32 bg-muted",
                      photoClasses[photos] ?? photoClasses.round,
                    ])}
                  />
                )}
                <Name className={part("gf-people-name", "font-heading text-lg font-semibold")}>
                  {person.link ? (
                    <SiteLink href={person.link} className="hover:underline">
                      {person.name}
                    </SiteLink>
                  ) : (
                    person.name
                  )}
                </Name>
                {person.role && (
                  <p className={part("gf-people-role", "text-sm font-medium text-primary")}>{person.role}</p>
                )}
                {person.bio && <p className={part("gf-people-bio", "text-muted-foreground")}>{person.bio}</p>}
                {person.email && (
                  <SiteLink
                    href={`mailto:${person.email.trim()}`}
                    className={part("gf-people-email", "text-sm text-primary underline underline-offset-4")}
                  >
                    {person.email.trim()}
                  </SiteLink>
                )}
              </li>
            ))}
          </ul>
        </section>
      );
    },
  },
  {
    "gf-people": "People",
    "gf-people-heading": "Heading",
    "gf-people-list": "List",
    "gf-people-person": "Person",
    "gf-people-photo": "Photo",
    "gf-people-name": "Name",
    "gf-people-role": "Role",
    "gf-people-bio": "A few words",
    "gf-people-email": "Email address",
  },
);

export default withKeywords(People, [
  "team",
  "staff",
  "people",
  "board",
  "council",
  "clergy",
  "volunteers",
  "about us",
]);
