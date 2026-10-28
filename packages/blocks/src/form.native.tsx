import { formTarget, googleFormUrl } from "@goodfellow-cms/core";
import { SiteButton, SiteText, TEXT, useNativeSite, WebFrame } from "@goodfellow-cms/expo";
import { useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { answerNames, choicesOf, type FormField, type FormProps } from "./form-data.js";

/** Hidden fields that only make sense for a browser's form post, such as where it goes afterwards. */
const BROWSER_ONLY = new Set(["redirect", "_next"]);

const KEYBOARDS = { email: "email-address", phone: "phone-pad", number: "numeric" } as const;

function Question({
  field,
  name,
  answers,
  set,
  unanswered,
}: {
  field: FormField;
  name: string;
  answers: Record<string, string>;
  set: (name: string, value: string) => void;
  /** Whether it needs an answer it hasn't got, after trying to send. */
  unanswered: boolean;
}) {
  const { colors, radius } = useNativeSite().theme;
  const label = `${(field.label ?? "").trim() || name}${field.required ? " *" : ""}`;
  const hint = field.hint ? (
    <SiteText muted style={{ fontSize: TEXT.sm }}>
      {field.hint}
    </SiteText>
  ) : null;
  const choice = (key: string, text: string, chosen: boolean, onPress: () => void, radio: boolean) => (
    <Pressable
      key={key}
      accessibilityRole={radio ? "radio" : "checkbox"}
      accessibilityState={{ checked: chosen }}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderWidth: 2,
          borderColor: chosen ? colors.primary : colors.border,
          backgroundColor: chosen ? colors.primary : "transparent",
          borderRadius: radio ? 9 : 4,
        }}
      />
      <SiteText>{text}</SiteText>
    </Pressable>
  );

  if (field.type === "checkbox") {
    return (
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch
            accessibilityLabel={label}
            value={answers[name] === "Yes"}
            onValueChange={(on) => set(name, on ? "Yes" : "")}
          />
          <SiteText style={{ flex: 1, fontWeight: unanswered ? "700" : "400" }}>{label}</SiteText>
        </View>
        {hint}
      </View>
    );
  }
  if (field.type === "radio" || field.type === "select" || field.type === "checkboxes") {
    const many = field.type === "checkboxes";
    return (
      <View accessibilityRole={many ? undefined : "radiogroup"} accessibilityLabel={label} style={{ gap: 4 }}>
        <SiteText style={{ fontWeight: unanswered ? "700" : "500" }}>{label}</SiteText>
        {hint}
        {choicesOf(field).map((item) => {
          // Each of "Any of several choices" is its own answer, as on the web.
          const key = many ? `${name}: ${item}` : name;
          const chosen = many ? answers[key] === "Yes" : answers[name] === item;
          return choice(item, item, chosen, () => set(key, many ? (chosen ? "" : "Yes") : item), !many);
        })}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <SiteText style={{ fontWeight: "500" }}>{label}</SiteText>
      {hint}
      <TextInput
        accessibilityLabel={label}
        value={answers[name] ?? ""}
        onChangeText={(text) => set(name, text)}
        multiline={field.type === "textarea"}
        numberOfLines={field.type === "textarea" ? 5 : 1}
        {...(field.type === "date" && { placeholder: "YYYY-MM-DD" })}
        {...(field.type in KEYBOARDS && { keyboardType: KEYBOARDS[field.type as keyof typeof KEYBOARDS] })}
        {...(field.type === "email" && { autoComplete: "email" as const, autoCapitalize: "none" as const })}
        {...(field.type === "phone" && { autoComplete: "tel" as const })}
        style={{
          borderWidth: unanswered ? 2 : 1,
          borderColor: unanswered ? colors.primary : colors.border,
          borderRadius: radius,
          paddingHorizontal: 12,
          paddingVertical: 8,
          color: colors.foreground,
          backgroundColor: colors.background,
          fontSize: TEXT.base,
          ...(field.type === "textarea" && { minHeight: 120, textAlignVertical: "top" as const }),
        }}
      />
    </View>
  );
}

/**
 * A form whose answers the app sends to the site's form service itself, as
 * the website's form would; or a Google form. Forms with a captcha open on
 * the website, since the captcha only works there.
 */
export function Form(props: FormProps) {
  const site = useNativeSite();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"ready" | "sending" | "sent" | "failed">("ready");
  const [unanswered, setUnanswered] = useState<Set<string>>(new Set());
  const fields = props.fields ?? [];
  const names = answerNames(fields);

  if (props.source === "google") {
    const form = googleFormUrl(props.google);
    if ("problem" in form) return null;
    return <WebFrame uri={form.url} title={props.title || "Form"} height={form.height ?? props.height} />;
  }
  const target = formTarget(site.settings.forms, {
    subject: props.title.trim() || undefined,
    from: site.settings.title,
  });
  if ("problem" in target) return null;
  if ("captcha" in target && target.captcha) {
    return <SiteButton label={props.submitLabel || "Send"} href={site.address(site.path || "/")} />;
  }
  if (state === "sent" && !props.thankYou.trim().startsWith("/")) {
    return <SiteText>{props.sentText}</SiteText>;
  }

  const send = async () => {
    const missing = new Set(
      names.filter((name, index) => {
        const field = fields[index];
        return field?.required && field.type !== "checkboxes" && !(answers[name] ?? "").trim();
      }),
    );
    setUnanswered(missing);
    if (missing.size > 0) return;
    setState("sending");
    const body = new URLSearchParams();
    for (const hidden of target.hidden) if (!BROWSER_ONLY.has(hidden.name)) body.append(hidden.name, hidden.value);
    for (const [name, value] of Object.entries(answers)) if (value) body.append(name, value);
    try {
      const response = await fetch(target.action, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("sent");
      setAnswers({});
      if (props.thankYou.trim().startsWith("/")) site.open(props.thankYou.trim());
    } catch {
      setState("failed");
    }
  };

  return (
    <View style={{ gap: 20, width: "100%", maxWidth: 576 }}>
      {fields.map((field, index) => (
        <Question
          key={names[index]}
          field={field}
          name={names[index] ?? ""}
          answers={answers}
          unanswered={unanswered.has(names[index] ?? "")}
          set={(name, value) => setAnswers((current) => ({ ...current, [name]: value }))}
        />
      ))}
      {state === "failed" && props.failedText ? (
        <SiteText style={{ fontWeight: "600" }}>{props.failedText}</SiteText>
      ) : null}
      <SiteButton label={props.submitLabel || "Send"} onPress={send} disabled={state === "sending"} />
    </View>
  );
}
