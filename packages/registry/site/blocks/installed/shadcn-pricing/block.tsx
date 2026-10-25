import { classNameField, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string;
  buttonLabel: string;
  buttonLink: string;
  badge: string;
}

export interface PricingProps {
  title: string;
  intro: string;
  plans: Plan[];
  className: string;
}

const emptyPlan: Plan = {
  name: "Plan",
  price: "$10",
  period: "a month",
  description: "",
  features: "Something included\nSomething else included",
  buttonLabel: "Choose",
  buttonLink: "/contact",
  badge: "",
};

/** Plans side by side, with prices, what each includes and a button. */
const Pricing: ComponentConfig<PricingProps> = withParts(
  {
    label: "Pricing table",
    fields: {
      title: { type: "text", label: "Heading" },
      intro: { type: "textarea", label: "Introduction" },
      plans: {
        type: "array",
        label: "Plans",
        arrayFields: {
          name: { type: "text", label: "Name" },
          price: { type: "text", label: "Price, such as $10" },
          period: { type: "text", label: "Per, such as a month" },
          description: { type: "textarea", label: "Description" },
          features: { type: "textarea", label: "What's included, one per line" },
          buttonLabel: { type: "text", label: "Button" },
          buttonLink: { type: "text", label: "Button links to" },
          badge: { type: "text", label: "Label at the top, such as Most popular (optional)" },
        },
        defaultItemProps: emptyPlan,
        getItemSummary: (plan) => plan.name || "Plan",
      },
      className: classNameField,
    },
    defaultProps: {
      title: "Prices",
      intro: "",
      plans: [
        { ...emptyPlan, name: "Basic" },
        { ...emptyPlan, name: "Standard", price: "$25", badge: "Most popular" },
        { ...emptyPlan, name: "Premium", price: "$50" },
      ],
      className: "",
    },
    render: ({ title, intro, plans, className }) => {
      const part = useParts();
      return (
        <section className={part("gf-shadcn-pricing", "mx-auto w-full max-w-6xl px-4 py-12", className)}>
          {(title || intro) && (
            <div className={part("gf-shadcn-pricing-header", "mb-8 flex flex-col items-center gap-3 text-center")}>
              {title && (
                <h2 className={part("gf-shadcn-pricing-heading", "text-3xl font-bold tracking-tight")}>{title}</h2>
              )}
              {intro && (
                <p className={part("gf-shadcn-pricing-intro", "max-w-2xl text-lg text-muted-foreground")}>{intro}</p>
              )}
            </div>
          )}
          <div className={part("gf-shadcn-pricing-grid", "grid gap-6 md:grid-cols-2 lg:grid-cols-3")}>
            {plans.map((plan, index) => (
              <Card
                // biome-ignore lint/suspicious/noArrayIndexKey: plans have no ids of their own
                key={index}
                className={part("gf-shadcn-pricing-plan", undefined, plan.badge && "border-primary border-2")}
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className={part("gf-shadcn-pricing-name", "text-xl")}>{plan.name}</CardTitle>
                    {plan.badge && <Badge className={part("gf-shadcn-pricing-badge")}>{plan.badge}</Badge>}
                  </div>
                  {plan.description && (
                    <CardDescription className={part("gf-shadcn-pricing-description")}>
                      {plan.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-6">
                  <p>
                    <span className={part("gf-shadcn-pricing-price", "text-4xl font-bold")}>{plan.price}</span>
                    {plan.period && (
                      <span className={part("gf-shadcn-pricing-period", "text-muted-foreground")}> {plan.period}</span>
                    )}
                  </p>
                  <ul className={part("gf-shadcn-pricing-features", "flex flex-col gap-2")}>
                    {plan.features
                      .split("\n")
                      .map((feature) => feature.trim())
                      .filter(Boolean)
                      .map((feature) => (
                        <li key={feature} className={part("gf-shadcn-pricing-feature", "flex items-start gap-2")}>
                          <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                          {feature}
                        </li>
                      ))}
                  </ul>
                </CardContent>
                {plan.buttonLabel && (
                  <CardFooter>
                    <SiteLink
                      href={plan.buttonLink || "/"}
                      className={part("gf-shadcn-pricing-button", [
                        buttonVariants({ variant: plan.badge ? "default" : "outline" }),
                        "w-full",
                      ])}
                    >
                      {plan.buttonLabel}
                    </SiteLink>
                  </CardFooter>
                )}
              </Card>
            ))}
          </div>
        </section>
      );
    },
  },
  {
    "gf-shadcn-pricing": "Pricing",
    "gf-shadcn-pricing-header": "Heading and introduction",
    "gf-shadcn-pricing-heading": "Heading",
    "gf-shadcn-pricing-intro": "Introduction",
    "gf-shadcn-pricing-grid": "Grid of plans",
    "gf-shadcn-pricing-plan": "Plan",
    "gf-shadcn-pricing-name": "Plan's name",
    "gf-shadcn-pricing-badge": "Badge",
    "gf-shadcn-pricing-description": "Plan's description",
    "gf-shadcn-pricing-price": "Price",
    "gf-shadcn-pricing-period": "Period",
    "gf-shadcn-pricing-features": "Features",
    "gf-shadcn-pricing-feature": "Feature",
    "gf-shadcn-pricing-button": "Button",
  },
);

export default Pricing;
