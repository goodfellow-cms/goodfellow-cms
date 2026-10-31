import { Disclosure, RichText, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import type { FaqProps } from "./faq.js";
import { faqItems } from "./faq-data.js";

/** Questions and answers, each opening to show its answer. */
export function Faq({ id, heading, items }: FaqProps & { id?: string }) {
  const site = useNativeSite();
  // Each question keeps its place in the block's list, which its answer's formatted text is kept by.
  const shown = (Array.isArray(items) ? items : [])
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => faqItems([item]).length > 0);
  if (shown.length === 0 && !heading) return null;
  return (
    <View style={{ marginVertical: 24, gap: 8 }}>
      {heading ? (
        <SiteText heading={2} style={{ fontSize: TEXT["2xl"], fontWeight: "600" }}>
          {heading}
        </SiteText>
      ) : null}
      {shown.map(({ index, item }) => (
        <Disclosure key={index} summary={String(item.question)}>
          <RichText nodes={id ? site.richText(id, `items.${index}.answer`) : undefined} />
        </Disclosure>
      ))}
    </View>
  );
}
