import {
  consentInLanguage,
  isLanguageCode,
  languageName,
  languagePrefix,
  mainLanguage,
  pathLanguage,
  type SiteContent,
  type SiteSettings,
} from "@goodfellow-cms/core";
import { useMemo } from "react";
import { CONSENT_WORDS, ConsentWordField, shownConsentWords } from "./consent-settings.js";
import { useStrings } from "./strings.js";
import { Button, TextField } from "./ui.js";

type Translation = NonNullable<SiteSettings["translations"]>[string];

/** How many pages and items each of the site's other languages has, which removing it would leave without a language. */
export function languagesInUse(content: SiteContent): Map<string, number> {
  const used = new Map<string, number>();
  const count = (code: string) => used.set(code, (used.get(code) ?? 0) + 1);
  const main = mainLanguage(content.settings);
  for (const page of content.pages) {
    const language = pathLanguage(content.settings, page.path);
    if (language !== main) count(language);
  }
  for (const collection of content.collections) {
    for (const entry of collection.entries) {
      if (entry.content.inLanguage) count(entry.content.inLanguage);
    }
  }
  return used;
}

/** Leaves out languages' empty settings, and translations of languages the site no longer has. */
export function cleanLanguages(draft: SiteSettings): Pick<SiteSettings, "languageName" | "languages" | "translations"> {
  const optional = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const languages = (draft.languages ?? []).map(({ code, name }) => ({
    code: code.trim(),
    ...(optional(name) && { name: optional(name) }),
  }));
  const translations = Object.fromEntries(
    languages.flatMap(({ code }) => {
      const own = draft.translations?.[code];
      const kept: Translation = {
        ...(optional(own?.title) && { title: optional(own?.title) }),
        ...(optional(own?.description) && { description: optional(own?.description) }),
        ...(optional(own?.titleTemplate) && { titleTemplate: optional(own?.titleTemplate) }),
      };
      const consent = Object.fromEntries(
        CONSENT_WORDS.flatMap((word) =>
          optional(own?.consent?.[word]) ? [[word, optional(own?.consent?.[word])]] : [],
        ),
      );
      if (draft.consent && Object.keys(consent).length > 0) kept.consent = consent;
      return Object.keys(kept).length > 0 ? [[code, kept]] : [];
    }),
  );
  return {
    languageName: optional(draft.languageName),
    languages: languages.length > 0 ? languages : undefined,
    translations: Object.keys(translations).length > 0 ? translations : undefined,
  };
}

/** Why a new language's code can't be used, in plain words, if it can't. */
function codeProblem(
  t: ReturnType<typeof useStrings>,
  draft: SiteSettings,
  index: number,
  content: SiteContent,
): string | undefined {
  const code = draft.languages?.[index]?.code.trim() ?? "";
  if (!isLanguageCode(code)) return t("languages.codeInvalid");
  const lower = code.toLowerCase();
  const others = [draft.language, ...(draft.languages ?? []).filter((_, other) => other !== index).map((l) => l.code)];
  if (others.some((other) => other.trim().toLowerCase() === lower)) return t("languages.codeTaken");
  // Its pages would go under its code, so a page there already that isn't its home page would be in it.
  const prefix = languagePrefix(code);
  const known = new Set(content.settings.languages?.map((language) => language.code));
  if (!known.has(code) && content.pages.some((page) => page.path.startsWith(`${prefix}/`))) {
    return t("languages.codeUsed", { prefix });
  }
  return undefined;
}

/** Whether the Languages tab has a problem that stops publishing. */
export function languagesProblem(t: ReturnType<typeof useStrings>, draft: SiteSettings, content: SiteContent): boolean {
  return (draft.languages ?? []).some((_, index) => codeProblem(t, draft, index, content) !== undefined);
}

/**
 * The site's languages: the main one, whose pages are at the site's address,
 * and the others, whose pages are under their codes, each with the site's
 * title and description in it.
 */
export function LanguagesTab({
  draft,
  content,
  showErrors,
  onChange,
}: {
  draft: SiteSettings;
  content: SiteContent;
  showErrors: boolean;
  onChange: (draft: SiteSettings) => void;
}) {
  const t = useStrings();
  const used = useMemo(() => languagesInUse(content), [content]);
  const published = new Set(content.settings.languages?.map((language) => language.code));
  const languages = draft.languages ?? [];
  const setLanguages = (next: NonNullable<SiteSettings["languages"]>) => onChange({ ...draft, languages: next });
  const setTranslation = (code: string, key: keyof Translation, value: string) =>
    onChange({
      ...draft,
      translations: { ...draft.translations, [code]: { ...draft.translations?.[code], [key]: value } },
    });
  const mainPublished = content.settings.language;

  return (
    <div className="gfa-form">
      <p className="gfa-hint">{t("languages.intro")}</p>
      <h2 className="gfa-section-title">{t("languages.main")}</h2>
      <TextField
        label={t("general.language")}
        hint={t(used.size > 0 ? "languages.mainCodeHintUsed" : "general.languageHint")}
        value={draft.language}
        onChange={(language) => onChange({ ...draft, language })}
        disabled={used.size > 0 && draft.language === mainPublished}
      />
      <TextField
        label={t("languages.name")}
        hint={t("languages.nameHint")}
        placeholder={languageName(draft.language)}
        value={draft.languageName ?? ""}
        onChange={(languageName) => onChange({ ...draft, languageName })}
      />

      {languages.map((language, index) => {
        const code = language.code.trim();
        const isNew = !published.has(code);
        const count = used.get(code) ?? 0;
        const problem = isNew && showErrors ? codeProblem(t, draft, index, content) : undefined;
        const own = draft.translations?.[code];
        return (
          // The index is the row's identity: codes change as a new one is typed.
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are only added at the end or removed
          <section key={index} className="gfa-language-card" aria-label={language.name || languageName(code) || code}>
            <h2 className="gfa-section-title">{language.name || (code ? languageName(code) : t("languages.new"))}</h2>
            <TextField
              label={t("general.language")}
              hint={
                isNew ? t("languages.codeHint") : t("languages.codeHintPublished", { prefix: languagePrefix(code) })
              }
              value={language.code}
              error={problem}
              disabled={!isNew}
              onChange={(next) =>
                setLanguages(languages.map((l, other) => (other === index ? { ...l, code: next } : l)))
              }
            />
            <TextField
              label={t("languages.name")}
              hint={t("languages.nameHint")}
              placeholder={code ? languageName(code) : ""}
              value={language.name ?? ""}
              onChange={(name) => setLanguages(languages.map((l, other) => (other === index ? { ...l, name } : l)))}
            />
            <TextField
              label={t("general.siteTitle")}
              hint={t("languages.titleHint")}
              placeholder={draft.title}
              value={own?.title ?? ""}
              onChange={(value) => setTranslation(code, "title", value)}
            />
            <TextField
              label={t("general.description")}
              placeholder={draft.description}
              value={own?.description ?? ""}
              onChange={(value) => setTranslation(code, "description", value)}
            />
            <TextField
              label={t("general.titleTemplate")}
              hint={t("general.titleTemplateHint")}
              placeholder={draft.titleTemplate}
              value={own?.titleTemplate ?? ""}
              onChange={(value) => setTranslation(code, "titleTemplate", value)}
            />
            {draft.consent &&
              shownConsentWords(draft.consent).map((word) => (
                <ConsentWordField
                  key={word}
                  word={word}
                  // What the language shows without words of its own.
                  placeholder={draft.consent && consentInLanguage(draft.consent, code, draft.language)[word]}
                  value={own?.consent?.[word] ?? ""}
                  onChange={(value) =>
                    onChange({
                      ...draft,
                      translations: {
                        ...draft.translations,
                        [code]: { ...own, consent: { ...own?.consent, [word]: value } },
                      },
                    })
                  }
                />
              ))}
            {count > 0 ? (
              <p className="gfa-hint">{t("languages.inUse", { count: String(count) })}</p>
            ) : (
              <Button variant="danger" onClick={() => setLanguages(languages.filter((_, other) => other !== index))}>
                {t("languages.remove")}
              </Button>
            )}
          </section>
        );
      })}
      <div>
        <Button onClick={() => setLanguages([...languages, { code: "" }])}>{t("languages.add")}</Button>
      </div>
    </div>
  );
}
