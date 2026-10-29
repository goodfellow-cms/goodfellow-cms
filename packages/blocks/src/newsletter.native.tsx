import { SiteButton, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { type NewsletterProps, newsletterTarget } from "./newsletter-data.js";

/** Hidden fields that only make sense for a browser's form post, such as where it goes afterwards. */
const BROWSER_ONLY = new Set(["redirect", "_next"]);

/**
 * A newsletter signup. Through the site's form service, the app sends it
 * itself, as the Form block does; the newsletter services answer with pages
 * for browsers, so their signups open on the website.
 */
export function Newsletter(props: NewsletterProps) {
  const site = useNativeSite();
  const { colors, radius } = site.theme;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"ready" | "sending" | "sent" | "failed">("ready");
  const target = newsletterTarget(props, site.settings.forms, { from: site.settings.title });
  if ("problem" in target) return null;
  const centered = props.align !== "left";
  const button = props.buttonLabel || "Subscribe";
  const inApp = target.service === "forms" && !target.captcha;

  const input = (label: string, value: string, set: (text: string) => void, isEmail: boolean) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      value={value}
      onChangeText={set}
      {...(isEmail
        ? { keyboardType: "email-address" as const, autoComplete: "email" as const, autoCapitalize: "none" as const }
        : { autoComplete: "given-name" as const })}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
        paddingHorizontal: 12,
        paddingVertical: 8,
        color: colors.foreground,
        backgroundColor: colors.background,
        fontSize: TEXT.base,
      }}
    />
  );

  const send = async () => {
    if (!email.trim()) return;
    setState("sending");
    const body = new URLSearchParams();
    for (const hidden of target.hidden) if (!BROWSER_ONLY.has(hidden.name)) body.append(hidden.name, hidden.value);
    body.append(target.email, email.trim());
    if (props.askName && target.name && name.trim()) body.append(target.name, name.trim());
    try {
      const response = await fetch(target.action, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("sent");
      if (props.thankYou.trim().startsWith("/")) site.open(props.thankYou.trim());
    } catch {
      setState("failed");
    }
  };

  return (
    <View style={{ gap: 12, width: "100%", alignItems: centered ? "center" : "flex-start" }}>
      {props.heading ? (
        <SiteText heading={2} style={{ textAlign: centered ? "center" : "left" }}>
          {props.heading}
        </SiteText>
      ) : null}
      {props.text ? (
        <SiteText muted style={{ textAlign: centered ? "center" : "left" }}>
          {props.text}
        </SiteText>
      ) : null}
      {!inApp ? (
        <SiteButton label={button} href={site.address(site.path || "/")} />
      ) : state === "sent" ? (
        <SiteText>{props.sentText || "Thank you. You're signed up."}</SiteText>
      ) : (
        <View style={{ gap: 8, width: "100%", maxWidth: 448 }}>
          {props.askName && target.name ? input(props.nameLabel || "First name", name, setName, false) : null}
          {input(props.emailLabel || "Email address", email, setEmail, true)}
          {state === "failed" ? (
            <SiteText style={{ fontWeight: "600" }}>
              {props.failedText || "You couldn't be signed up. Check your connection and try again."}
            </SiteText>
          ) : null}
          <SiteButton label={button} onPress={send} disabled={state === "sending"} />
        </View>
      )}
      {props.note ? (
        <SiteText muted style={{ fontSize: TEXT.sm, textAlign: centered ? "center" : "left" }}>
          {props.note}
        </SiteText>
      ) : null}
    </View>
  );
}
