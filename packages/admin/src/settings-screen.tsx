import {
  CODE_THEMES,
  contrastProblems,
  DEFAULT_CODE_THEMES,
  DEFAULT_DARK_THEME_COLORS,
  DEFAULT_THEME_COLORS,
  type FileChange,
  type FormSettings,
  formTarget,
  HeadCodeError,
  type Menus,
  menusFileSchema,
  pageView,
  parseHeadCode,
  type Redirect,
  redirectProblems,
  type SiteCode,
  type SiteProblem,
  type SiteSettings,
  serializeContent,
  sitePages,
  siteSettingsSchema,
  storedRedirects,
  THEME_COLORS,
  type ThemeColor,
  todayIn,
} from "@goodfellow-cms/core";
import { PageBody, type SiteContextValue, siteMetadata } from "@goodfellow-cms/react";
import { type Data, resolveAllData } from "@puckeditor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import {
  codeFileChanges,
  customCssFileChange,
  menusFileChange,
  redirectsFileChange,
  siteSettingsFileChange,
  storedCss,
} from "./changes.js";
import { CodeEditor } from "./code-editor.js";
import { FontPicker } from "./font-picker.js";
import { useHistory } from "./history.js";
import { MediaField } from "./media-library.js";
import { MenusEditor } from "./menus-editor.js";
import { PreviewFrame, type PreviewScheme } from "./preview.js";
import { filledRedirects, RedirectsEditor } from "./redirects-editor.js";
import { type SettingsSection, useUnsavedChanges } from "./router.js";
import { describeContrast } from "./site-checks.js";
import { type StringKey, useStrings } from "./strings.js";
import { useDarkMode } from "./theme.js";
import { Button, ErrorMessage, Field, PublishedNotice, TextField } from "./ui.js";
import { AppLink } from "./use-link.js";

export type SettingsTab = "general" | "theme" | "menus" | "redirects" | "css" | "code";
export const SETTINGS_TABS: SettingsTab[] = ["general", "theme", "menus", "redirects", "css", "code"];

const tabLabels: Record<SettingsTab, StringKey> = {
  general: "settings.tab.general",
  theme: "settings.tab.theme",
  menus: "settings.tab.menus",
  redirects: "settings.tab.redirects",
  css: "settings.tab.css",
  code: "settings.tab.code",
};

const EMPTY_CODE: SiteCode = { head: "", body: "" };

/** Why the head's code can't be published, in plain words, or `undefined` if it can. */
function headCodeProblem(t: ReturnType<typeof useStrings>, head: string): string | undefined {
  try {
    parseHeadCode(head);
    return undefined;
  } catch (error) {
    if (!(error instanceof HeadCodeError)) throw error;
    const { problem } = error;
    if (problem.code === "text") return t("code.error.text", { text: problem.text });
    if (problem.code === "tag") return t("code.error.tag", { tag: problem.tag });
    return t("code.error.unclosed", { tag: problem.tag === "!--" ? "<!--" : `<${problem.tag}>` });
  }
}

/** The colors the form has values for, leaving out the ones left at their defaults. */
function filledColors(colors: Partial<Record<ThemeColor, string>> | undefined): Partial<Record<ThemeColor, string>> {
  return Object.fromEntries(Object.entries(colors ?? {}).filter(([, value]) => value?.trim()));
}

/** Turns the form's values into settings: empty optional fields are left out rather than saved as "". */
function cleanSettings(draft: SiteSettings): unknown {
  const optional = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const colors = filledColors(draft.theme.colors);
  const darkColors = filledColors(draft.theme.darkColors);
  const darkLogo = optional(draft.logo?.darkSrc);
  return {
    ...draft,
    url: optional(draft.url),
    externalLinksInNewTab: draft.externalLinksInNewTab || undefined,
    timeZone: optional(draft.timeZone),
    favicon: optional(draft.favicon),
    socialImage: optional(draft.socialImage),
    logo: draft.logo?.src.trim()
      ? { src: draft.logo.src.trim(), alt: draft.logo.alt, ...(darkLogo && { darkSrc: darkLogo }) }
      : undefined,
    contact: cleanContact(draft.contact),
    forms: cleanForms(draft.forms),
    theme: {
      colors,
      fonts: cleanFonts(draft.theme.fonts),
      radius: optional(draft.theme.radius),
      // Dark colors are kept while dark mode is off, so turning it back on finds them again.
      darkMode: draft.theme.darkMode || undefined,
      darkColors: Object.keys(darkColors).length > 0 ? darkColors : undefined,
      code: cleanCode(draft.theme.code),
    },
  };
}

/** A font's kind is kept only with the font, which is all it's about. */
function cleanFonts(fonts: SiteSettings["theme"]["fonts"]): SiteSettings["theme"]["fonts"] {
  const heading = fonts.heading?.trim() || undefined;
  const body = fonts.body?.trim() || undefined;
  return {
    heading,
    ...(heading && fonts.headingCategory && { headingCategory: fonts.headingCategory }),
    body,
    ...(body && fonts.bodyCategory && { bodyCategory: fonts.bodyCategory }),
  };
}

function cleanCode(code: SiteSettings["theme"]["code"]): SiteSettings["theme"]["code"] {
  const cleaned = {
    ...(code?.light && { light: code.light }),
    ...(code?.dark && { dark: code.dark }),
    ...(code?.background === "site" && { background: "site" as const }),
  };
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function cleanContact(contact: SiteSettings["contact"]): SiteSettings["contact"] {
  const entries = Object.entries(contact ?? {}).flatMap(([key, value]) => (value?.trim() ? [[key, value.trim()]] : []));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Form settings without empty values, or `undefined` when they're all the defaults. */
function cleanForms(forms: FormSettings | undefined): FormSettings | undefined {
  if (!forms) return undefined;
  const accessKey = forms.accessKey?.trim();
  const address = forms.address?.trim();
  const cleaned: FormSettings = {
    service: forms.service,
    ...(accessKey && { accessKey }),
    ...(address && { address }),
    ...(forms.captcha && { captcha: true }),
  };
  return Object.keys(cleaned).length === 1 && cleaned.service === "web3forms" ? undefined : cleaned;
}

/** Why forms couldn't send answers with these settings, when what's written can't be used. Empty ones are fine. */
function formsProblem(t: ReturnType<typeof useStrings>, forms: FormSettings | undefined): string | undefined {
  const target = formTarget(forms);
  if (!("problem" in target)) return undefined;
  if (target.problem === "bad-key") return t("forms.error.key");
  if (target.problem === "bad-address")
    return t(forms?.service === "formspree" ? "forms.error.formspree" : "forms.error.address");
  return undefined;
}

const FORM_SERVICES: Array<FormSettings["service"]> = ["web3forms", "formspree", "other"];

/** Where forms' answers go: the service, and its key or address. */
function FormsSettings({
  forms,
  error,
  onChange,
}: {
  forms: FormSettings | undefined;
  error: string | undefined;
  onChange: (forms: FormSettings) => void;
}) {
  const t = useStrings();
  const current: FormSettings = forms ?? { service: "web3forms" };
  const set = (change: Partial<FormSettings>) => onChange({ ...current, ...change });
  return (
    <>
      <h2 id={sectionId("forms")} className="gfa-section-title" tabIndex={-1}>
        {t("forms.title")}
      </h2>
      <p className="gfa-hint">{t("forms.hint")}</p>
      <Field label={t("forms.service")}>
        {(props) => (
          <select
            {...props}
            className="gfa-input"
            value={current.service}
            onChange={(event) => set({ service: event.target.value as FormSettings["service"] })}
          >
            {FORM_SERVICES.map((service) => (
              <option key={service} value={service}>
                {t(`forms.service.${service}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {current.service === "web3forms" ? (
        <>
          <TextField
            label={t("forms.accessKey")}
            hint={t("forms.accessKeyHint")}
            error={error}
            spellCheck={false}
            autoComplete="off"
            value={current.accessKey ?? ""}
            onChange={(accessKey) => set({ accessKey })}
          />
          <a className="gfa-hint" href="https://app.web3forms.com/onboarding/create" target="_blank" rel="noreferrer">
            {t("forms.accessKeyLink")}
          </a>
          <label className="gfa-checkbox">
            <input
              type="checkbox"
              checked={current.captcha === true}
              onChange={(event) => set({ captcha: event.target.checked })}
            />
            {t("forms.captcha")}
          </label>
          <p className="gfa-hint">{t("forms.captchaHint")}</p>
        </>
      ) : (
        <TextField
          label={t(current.service === "formspree" ? "forms.formspree" : "forms.address")}
          hint={t(current.service === "formspree" ? "forms.formspreeHint" : "forms.addressHint")}
          error={error}
          type="url"
          placeholder={current.service === "formspree" ? "https://formspree.io/f/" : "https://"}
          spellCheck={false}
          value={current.address ?? ""}
          onChange={(address) => set({ address })}
        />
      )}
    </>
  );
}

/** Validation problems keyed by field path, such as `theme.colors.primary`. */
function validate(draft: SiteSettings): { settings?: SiteSettings; errors: Record<string, string> } {
  const result = siteSettingsSchema.safeParse(cleanSettings(draft));
  if (result.success) return { settings: result.data, errors: {} };
  return { errors: Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message])) };
}

/** The time zones this browser knows, such as `America/New_York`. */
function timeZones(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...known, "UTC", ...(current ? [current] : [])])].sort();
}

/** The time zone events' times are in, with the computer's own suggested. */
function TimeZoneField({ value, onChange }: { value: string; onChange: (timeZone: string) => void }) {
  const t = useStrings();
  const zones = useMemo(() => timeZones(value), [value]);
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Field label={t("general.timeZone")} hint={t("general.timeZoneHint")}>
      {(props) => (
        <div className="gfa-inline-form">
          <select {...props} className="gfa-input" value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{t("general.timeZoneNone")}</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {own && own !== value && (
            <Button onClick={() => onChange(own)}>
              {t("general.timeZoneUseMine", { zone: own.replace(/_/g, " ") })}
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

function GeneralTab({
  draft,
  errors,
  formsError,
  onChange,
}: {
  draft: SiteSettings;
  errors: Record<string, string>;
  formsError: string | undefined;
  onChange: (draft: SiteSettings) => void;
}) {
  const t = useStrings();
  const text = (key: "title" | "description" | "url" | "language" | "titleTemplate" | "favicon" | "socialImage") => ({
    value: draft[key] ?? "",
    error: errors[key],
    onChange: (value: string) => onChange({ ...draft, [key]: value }),
  });
  return (
    <div className="gfa-form">
      <TextField label={t("general.siteTitle")} {...text("title")} />
      <TextField label={t("general.description")} hint={t("general.descriptionHint")} {...text("description")} />
      <TextField
        label={t("general.url")}
        hint={t("general.urlHint")}
        type="url"
        placeholder="https://"
        {...text("url")}
      />
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={draft.externalLinksInNewTab === true}
          onChange={(event) => onChange({ ...draft, externalLinksInNewTab: event.target.checked })}
        />
        {t("general.externalLinksInNewTab")}
      </label>
      <p className="gfa-hint">{t("general.externalLinksInNewTabHint")}</p>
      <TextField label={t("general.titleTemplate")} hint={t("general.titleTemplateHint")} {...text("titleTemplate")} />
      <TextField label={t("general.language")} hint={t("general.languageHint")} {...text("language")} />
      <TimeZoneField value={draft.timeZone ?? ""} onChange={(timeZone) => onChange({ ...draft, timeZone })} />
      <MediaField
        label={t("general.logo")}
        value={draft.logo?.src ?? ""}
        error={errors["logo.src"]}
        onChange={(src) => onChange({ ...draft, logo: { ...draft.logo, alt: draft.logo?.alt ?? "", src } })}
      />
      <TextField
        label={t("general.logoAlt")}
        value={draft.logo?.alt ?? ""}
        onChange={(alt) => onChange({ ...draft, logo: { ...draft.logo, src: draft.logo?.src ?? "", alt } })}
      />
      {draft.theme.darkMode && (
        <MediaField
          label={t("general.logoDark")}
          hint={t("general.logoDarkHint")}
          value={draft.logo?.darkSrc ?? ""}
          onChange={(darkSrc) =>
            onChange({ ...draft, logo: { src: draft.logo?.src ?? "", alt: draft.logo?.alt ?? "", darkSrc } })
          }
        />
      )}
      <MediaField label={t("general.favicon")} {...text("favicon")} />
      <MediaField label={t("general.socialImage")} {...text("socialImage")} />

      <h2 id={sectionId("contact")} className="gfa-section-title" tabIndex={-1}>
        {t("general.contact")}
      </h2>
      <p className="gfa-hint">{t("general.contactHint")}</p>
      <Field label={t("general.address")}>
        {(props) => (
          <textarea
            {...props}
            className="gfa-input"
            rows={3}
            value={draft.contact?.address ?? ""}
            onChange={(event) => onChange({ ...draft, contact: { ...draft.contact, address: event.target.value } })}
          />
        )}
      </Field>
      <TextField
        label={t("general.phone")}
        type="tel"
        value={draft.contact?.phone ?? ""}
        onChange={(phone) => onChange({ ...draft, contact: { ...draft.contact, phone } })}
      />
      <TextField
        label={t("general.email")}
        type="email"
        value={draft.contact?.email ?? ""}
        onChange={(email) => onChange({ ...draft, contact: { ...draft.contact, email } })}
      />

      <FormsSettings forms={draft.forms} error={formsError} onChange={(forms) => onChange({ ...draft, forms })} />
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** One set of the theme's colors: the light ones, or dark mode's. */
function ColorGrid({
  colors,
  defaults,
  errors,
  errorPrefix,
  onChange,
}: {
  colors: Partial<Record<ThemeColor, string>>;
  defaults: Record<ThemeColor, string>;
  errors: Record<string, string>;
  errorPrefix: string;
  onChange: (name: ThemeColor, value: string) => void;
}) {
  const t = useStrings();
  return (
    <div className="gfa-color-grid">
      {THEME_COLORS.map((name) => {
        const value = colors[name] ?? "";
        const shown = value || defaults[name];
        return (
          <Field key={name} label={t(`theme.color.${name}` as StringKey)} error={errors[`${errorPrefix}.${name}`]}>
            {(props) => (
              <div className="gfa-color-input">
                <input
                  type="color"
                  aria-label={t("theme.pickColor", { name: t(`theme.color.${name}` as StringKey) })}
                  value={HEX.test(shown) ? shown : "#000000"}
                  onChange={(event) => onChange(name, event.target.value)}
                />
                <input
                  {...props}
                  className="gfa-input"
                  value={value}
                  placeholder={`${t("theme.default")}: ${defaults[name]}`}
                  onChange={(event) => onChange(name, event.target.value)}
                />
              </div>
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Text the colors chosen make hard to read, as the site checks will say when publishing. */
function ContrastNotes({ problems, dark }: { problems: SiteProblem[]; dark: boolean }) {
  const t = useStrings();
  const contrast = problems.flatMap((problem) =>
    problem.kind === "low-contrast" && problem.dark === dark ? [problem] : [],
  );
  if (contrast.length === 0) return null;
  return (
    <div className="gfa-notice" role="status">
      <ul className="gfa-check-list">
        {contrast.map((problem) => (
          <li key={`${problem.text} ${problem.background}`}>{describeContrast(t, problem)}</li>
        ))}
      </ul>
    </div>
  );
}

function ThemeTab({
  draft,
  errors,
  previewScheme,
  onChange,
  onPreviewScheme,
}: {
  draft: SiteSettings;
  errors: Record<string, string>;
  previewScheme: PreviewScheme;
  onChange: (draft: SiteSettings) => void;
  onPreviewScheme: (scheme: PreviewScheme) => void;
}) {
  const t = useStrings();
  const { theme } = draft;
  const setColor = (name: ThemeColor, value: string) =>
    onChange({ ...draft, theme: { ...theme, colors: { ...theme.colors, [name]: value } } });
  const setDarkColor = (name: ThemeColor, value: string) =>
    onChange({ ...draft, theme: { ...theme, darkColors: { ...theme.darkColors, [name]: value } } });
  const contrast = useMemo(
    () =>
      contrastProblems({
        ...theme,
        colors: filledColors(theme.colors),
        darkColors: filledColors(theme.darkColors),
      }),
    [theme],
  );

  return (
    <div className="gfa-form">
      <h2 className="gfa-section-title">{t("theme.colors")}</h2>
      <ColorGrid
        colors={theme.colors}
        defaults={DEFAULT_THEME_COLORS}
        errors={errors}
        errorPrefix="theme.colors"
        onChange={setColor}
      />
      <ContrastNotes problems={contrast} dark={false} />

      <h2 className="gfa-section-title">{t("theme.darkMode")}</h2>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={theme.darkMode === true}
          onChange={(event) => onChange({ ...draft, theme: { ...theme, darkMode: event.target.checked } })}
        />
        {t("theme.darkModeOn")}
      </label>
      <p className="gfa-hint">{t("theme.darkModeHint")}</p>
      {theme.darkMode && (
        <>
          <fieldset className="gfa-choice-group">
            <legend className="gfa-label">{t("theme.preview")}</legend>
            {(["light", "dark"] as const).map((scheme) => (
              <label key={scheme} className="gfa-checkbox">
                <input
                  type="radio"
                  name="preview-scheme"
                  checked={previewScheme === scheme}
                  onChange={() => onPreviewScheme(scheme)}
                />
                {t(scheme === "light" ? "theme.previewLight" : "theme.previewDark")}
              </label>
            ))}
          </fieldset>
          <fieldset className="gfa-choice-group">
            <legend className="gfa-label">{t("theme.darkColors")}</legend>
            <ColorGrid
              colors={theme.darkColors ?? {}}
              defaults={DEFAULT_DARK_THEME_COLORS}
              errors={errors}
              errorPrefix="theme.darkColors"
              onChange={setDarkColor}
            />
            <ContrastNotes problems={contrast} dark />
          </fieldset>
        </>
      )}

      <h2 className="gfa-section-title">{t("theme.code")}</h2>
      <p className="gfa-hint">{t("theme.codeHint")}</p>
      {(["light", "dark"] as const).map((side) => (
        <Field key={side} label={t(side === "light" ? "theme.codeLight" : "theme.codeDark")}>
          {(props) => (
            <select
              {...props}
              className="gfa-input"
              value={theme.code?.[side] ?? DEFAULT_CODE_THEMES[side]}
              onChange={(event) =>
                onChange({ ...draft, theme: { ...theme, code: { ...theme.code, [side]: event.target.value } } })
              }
            >
              {Object.entries(CODE_THEMES[side]).map(([name, label]) => (
                <option key={name} value={name}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      ))}
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={theme.code?.background === "site"}
          onChange={(event) =>
            onChange({
              ...draft,
              theme: { ...theme, code: { ...theme.code, background: event.target.checked ? "site" : undefined } },
            })
          }
        />
        {t("theme.codeBackground")}
      </label>
      <p className="gfa-hint">{t("theme.codeBackgroundHint")}</p>

      <h2 className="gfa-section-title">{t("theme.fonts")}</h2>
      <p className="gfa-hint">{t("theme.fontsHint")}</p>
      <FontPicker
        label={t("theme.headingFont")}
        value={theme.fonts.heading ?? ""}
        error={errors["theme.fonts.heading"]}
        onChange={(heading, headingCategory) =>
          onChange({ ...draft, theme: { ...theme, fonts: { ...theme.fonts, heading, headingCategory } } })
        }
      />
      <FontPicker
        label={t("theme.bodyFont")}
        value={theme.fonts.body ?? ""}
        error={errors["theme.fonts.body"]}
        onChange={(body, bodyCategory) =>
          onChange({ ...draft, theme: { ...theme, fonts: { ...theme.fonts, body, bodyCategory } } })
        }
      />
      <TextField
        label={t("theme.radius")}
        hint={t("theme.radiusHint")}
        value={theme.radius ?? ""}
        error={errors["theme.radius"]}
        onChange={(radius) => onChange({ ...draft, theme: { ...theme, radius } })}
      />
    </div>
  );
}

function CssTab({ css, onChange }: { css: string; onChange: (css: string) => void }) {
  const t = useStrings();
  return (
    <div className="gfa-form">
      <p className="gfa-hint">{t("css.intro")}</p>
      <Field label={t("css.label")} hint={t("code.editorHint")}>
        {(props) => (
          <CodeEditor
            label={t("css.label")}
            language="css"
            describedBy={props["aria-describedby"]}
            value={css}
            onChange={onChange}
          />
        )}
      </Field>
    </div>
  );
}

function CodeTab({
  code,
  headError,
  onChange,
}: {
  code: SiteCode;
  headError?: string;
  onChange: (code: SiteCode) => void;
}) {
  const t = useStrings();
  return (
    <div className="gfa-form">
      <p className="gfa-hint">{t("code.intro")}</p>
      <Field label={t("code.head")} hint={t("code.headHint")} error={headError}>
        {(props) => (
          <CodeEditor
            label={t("code.head")}
            language="html"
            minHeight="12rem"
            describedBy={props["aria-describedby"]}
            value={code.head}
            onChange={(head) => onChange({ ...code, head })}
          />
        )}
      </Field>
      <Field label={t("code.body")} hint={t("code.bodyHint")}>
        {(props) => (
          <CodeEditor
            label={t("code.body")}
            language="html"
            minHeight="12rem"
            describedBy={props["aria-describedby"]}
            value={code.body}
            onChange={(body) => onChange({ ...code, body })}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * The Site settings screens' tabs. Switching between the form's tabs keeps
 * unpublished changes, so it doesn't ask first; going to Domain, which has
 * nothing to publish, asks as leaving any screen does.
 */
export function SettingsTabs({ tab }: { tab: SettingsTab | "domain" | "editors" | "updates" | "history" | "import" }) {
  const t = useStrings();
  return (
    <nav className="gfa-tabs" aria-label={t("settings.title")}>
      {SETTINGS_TABS.map((name) => (
        <a key={name} href={`#/settings/${name}`} className="gfa-tab" aria-current={name === tab ? "page" : undefined}>
          {t(tabLabels[name])}
        </a>
      ))}
      <AppLink href="#/settings/domain" className="gfa-tab" aria-current={tab === "domain" ? "page" : undefined}>
        {t("settings.tab.domain")}
      </AppLink>
      <AppLink href="#/settings/editors" className="gfa-tab" aria-current={tab === "editors" ? "page" : undefined}>
        {t("settings.tab.editors")}
      </AppLink>
      <AppLink href="#/settings/updates" className="gfa-tab" aria-current={tab === "updates" ? "page" : undefined}>
        {t("settings.tab.updates")}
      </AppLink>
      <AppLink href="#/settings/history" className="gfa-tab" aria-current={tab === "history" ? "page" : undefined}>
        {t("settings.tab.history")}
      </AppLink>
      <AppLink href="#/settings/import" className="gfa-tab" aria-current={tab === "import" ? "page" : undefined}>
        {t("settings.tab.import")}
      </AppLink>
    </nav>
  );
}

/**
 * Site settings, theme, menus, custom CSS and the site's own code, with a live
 * preview of the home page (without the code, which never runs in the admin
 * panel). Publishing saves every changed file in one go.
 */
/** The id of a General tab section's heading, which links scroll to. */
function sectionId(section: SettingsSection): string {
  return `gfa-settings-${section}`;
}

export function SettingsScreen({ tab, section }: { tab: SettingsTab; section?: SettingsSection }) {
  // A link to a section, such as from a block's note in the editor, scrolls down to it.
  useEffect(() => {
    if (tab !== "general" || !section) return;
    const heading = document.getElementById(sectionId(section));
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [tab, section]);
  const t = useStrings();
  const { config, pageConfig, layoutConfig, publish, reload } = useAdmin();
  const { content } = useSiteContent();
  // One history for every tab, so undo takes back the last change wherever it was made.
  const history = useHistory<{
    settings: SiteSettings;
    menus: Menus;
    redirects: Redirect[];
    redirectMessage: string;
    css: string;
    code: SiteCode;
  }>({
    settings: content.settings,
    menus: content.menus,
    redirects: content.redirects ?? [],
    redirectMessage: content.redirectMessage ?? "",
    css: content.customCss,
    code: content.code ?? EMPTY_CODE,
  });
  const { settings, menus, redirects, redirectMessage, css, code } = history.present;
  const { update } = history;
  const setSettings = useCallback((settings: SiteSettings) => update((form) => ({ ...form, settings })), [update]);
  const setMenus = useCallback((menus: Menus) => update((form) => ({ ...form, menus })), [update]);
  const setRedirects = useCallback((redirects: Redirect[]) => update((form) => ({ ...form, redirects })), [update]);
  const setRedirectMessage = useCallback(
    (redirectMessage: string) => update((form) => ({ ...form, redirectMessage })),
    [update],
  );
  const setCss = useCallback((css: string) => update((form) => ({ ...form, css })), [update]);
  const setCode = useCallback((code: SiteCode) => update((form) => ({ ...form, code })), [update]);
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<
    | { type: "idle" | "publishing" | "done" | "invalid" }
    | { type: "failed"; reason: "conflict" | "error"; error: unknown }
  >({ type: "idle" });

  const validation = useMemo(() => validate(settings), [settings]);
  const headError = useMemo(() => headCodeProblem(t, code.head), [t, code.head]);
  const formsError = useMemo(() => formsProblem(t, settings.forms), [t, settings.forms]);
  // Rows left empty aren't saved.
  const savedRedirects = useMemo(() => storedRedirects(filledRedirects(redirects)), [redirects]);
  const redirectsInvalid = useMemo(() => redirectProblems(savedRedirects).some(Boolean), [savedRedirects]);
  // Addresses with pages, as builds have them, which win over redirects.
  const taken = useMemo(
    () => sitePages(content, todayIn(content.settings.timeZone), config.blocks).map((page) => page.path),
    [content, config.blocks],
  );
  const changes = useMemo(() => {
    const result: FileChange[] = [];
    if (validation.settings && serializeContent(validation.settings) !== serializeContent(content.settings)) {
      result.push(siteSettingsFileChange(validation.settings));
    }
    if (serializeContent(menus) !== serializeContent(content.menus)) result.push(menusFileChange(menus));
    if (
      serializeContent(savedRedirects) !== serializeContent(content.redirects ?? []) ||
      redirectMessage.trim() !== (content.redirectMessage ?? "").trim()
    ) {
      result.push(redirectsFileChange({ redirects: savedRedirects, message: redirectMessage }));
    }
    if (storedCss(css) !== storedCss(content.customCss)) result.push(customCssFileChange(css));
    result.push(...codeFileChanges(code, content.code));
    return result;
  }, [validation, menus, savedRedirects, redirectMessage, css, code, content]);

  const dirty = changes.length > 0 || !validation.settings;
  // "Published." goes after a few seconds, or as soon as anything changes.
  const hidePublished = useCallback(
    () => setStatus((current) => (current.type === "done" ? { type: "idle" } : current)),
    [],
  );
  useEffect(() => {
    if (dirty) hidePublished();
  }, [dirty, hidePublished]);
  useUnsavedChanges(dirty);

  const onPublish = async () => {
    setShowErrors(true);
    if (
      !validation.settings ||
      !menusFileSchema.safeParse({ version: 1, menus }).success ||
      headError ||
      formsError ||
      redirectsInvalid
    ) {
      setStatus({ type: "invalid" });
      return;
    }
    if (changes.length === 0) return;
    setStatus({ type: "publishing" });
    const result = await publish(changes, t("settings.message"));
    if (result.ok) setStatus({ type: "done" });
    else if (result.reason === "checks") setStatus({ type: "idle" });
    else setStatus({ type: "failed", reason: result.reason, error: result.error });
  };

  // The preview shows unpublished changes as they're made.
  const previewSettings = validation.settings ?? content.settings;
  const home = content.pages.find((page) => page.path === "/");
  // The home page as builds show it, with its added pages' links on the block they're for.
  const homeView = useMemo(
    () => home && pageView(home, content, todayIn(content.settings.timeZone), config.blocks),
    [home, content, config.blocks],
  );
  const previewSite = useMemo<SiteContextValue>(
    () => ({
      settings: previewSettings,
      menus,
      path: "/",
      collections: content.collections,
      ...(homeView && { view: homeView }),
    }),
    [previewSettings, menus, content.collections, homeView],
  );
  // Blocks whose look depends on the settings, such as code's colors, are prepared again as they change.
  const [resolvedHome, setResolvedHome] = useState<Data>();
  useEffect(() => {
    if (!home) return;
    let current = true;
    const timer = setTimeout(() => {
      resolveAllData(home.content.data as Data, pageConfig, siteMetadata(previewSite)).then(
        (data) => current && setResolvedHome(data),
        () => {},
      );
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [home, pageConfig, previewSite]);
  // Light or dark, as chosen on the Theme tab, or like the admin panel until then.
  const adminDark = useDarkMode();
  const [chosenScheme, setChosenScheme] = useState<PreviewScheme>();
  const previewScheme: PreviewScheme = chosenScheme ?? (adminDark ? "dark" : "light");
  const previewStyles = useMemo(
    () => ({ theme: previewSettings.theme, customCss: css, scheme: previewScheme }),
    [previewSettings, css, previewScheme],
  );
  const errors = showErrors ? validation.errors : {};

  return (
    <div className="gfa-split">
      <div className="gfa-split-main">
        <div className="gfa-screen-header">
          <h1>{t("settings.title")}</h1>
          <div className="gfa-header-actions">
            <Button variant="ghost" title={t("action.undoHint")} disabled={!history.canUndo} onClick={history.undo}>
              {t("action.undo")}
            </Button>
            <Button variant="ghost" title={t("action.redoHint")} disabled={!history.canRedo} onClick={history.redo}>
              {t("action.redo")}
            </Button>
            <Button
              variant="primary"
              disabled={status.type === "publishing" || !dirty}
              onClick={() => void onPublish()}
            >
              {status.type === "publishing" ? t("publish.publishing") : t("publish.button")}
            </Button>
            {status.type === "done" && <PublishedNotice onHide={hidePublished} />}
          </div>
        </div>
        {status.type === "invalid" && <ErrorMessage message={t("publish.invalid")} />}
        {status.type === "failed" && (
          <ErrorMessage
            message={t(status.reason === "conflict" ? "publish.conflict" : "publish.error")}
            error={status.error}
            action={
              status.reason === "conflict" ? (
                <Button onClick={() => void reload()}>{t("action.reload")}</Button>
              ) : undefined
            }
          />
        )}

        <SettingsTabs tab={tab} />

        {tab === "general" && (
          <GeneralTab
            draft={settings}
            errors={errors}
            formsError={showErrors ? formsError : undefined}
            onChange={setSettings}
          />
        )}
        {tab === "theme" && (
          <ThemeTab
            draft={settings}
            errors={errors}
            previewScheme={previewScheme}
            onChange={setSettings}
            onPreviewScheme={setChosenScheme}
          />
        )}
        {tab === "menus" && <MenusEditor menus={menus} onChange={setMenus} />}
        {tab === "redirects" && (
          <RedirectsEditor
            redirects={redirects}
            message={redirectMessage}
            taken={taken}
            showErrors={showErrors}
            onChange={setRedirects}
            onMessageChange={setRedirectMessage}
          />
        )}
        {tab === "css" && <CssTab css={css} onChange={setCss} />}
        {tab === "code" && <CodeTab code={code} headError={showErrors ? headError : undefined} onChange={setCode} />}
      </div>

      <section className="gfa-split-preview" aria-label={t("settings.preview")}>
        <h2 className="gfa-visually-hidden">{t("settings.preview")}</h2>
        {home ? (
          <PreviewFrame title={t("settings.preview")} styles={previewStyles}>
            <PageBody
              site={previewSite}
              pageConfig={pageConfig}
              layoutConfig={layoutConfig}
              page={resolvedHome ?? (home.content.data as Data)}
              header={content.header.data as Data}
              footer={content.footer.data as Data}
            />
          </PreviewFrame>
        ) : (
          <p className="gfa-hint">{t("settings.previewEmpty")}</p>
        )}
      </section>
    </div>
  );
}
