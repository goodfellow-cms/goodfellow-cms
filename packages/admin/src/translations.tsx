import {
  allPages,
  type Collection,
  type Entry,
  entrySourceHash,
  entryTranslations,
  hasLanguages,
  mainLanguage,
  type Page,
  pageLanguage,
  pageSourceHash,
  pageTranslations,
  type SiteContent,
  type SiteLanguage,
  siteLanguages,
  translationState,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { type FormEvent, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import {
  type AddressProblem,
  checkEntrySlug,
  checkPageAddress,
  type EntryNameProblem,
  entryFileChange,
  pageFileChange,
  pageTitle,
} from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { entryEditorHref, navigate, pageEditorHref } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, TextField } from "./ui.js";

const addressErrors: Record<AddressProblem, StringKey> = {
  invalid: "address.invalid",
  reserved: "address.reserved",
  taken: "address.taken",
};

const nameErrors: Record<EntryNameProblem, StringKey> = {
  invalid: "entryName.invalid",
  reserved: "entryName.reserved",
  taken: "entryName.taken",
};

/** The site's other languages, which pages and items in the main language are translated into. */
export function otherLanguages(content: SiteContent): SiteLanguage[] {
  return siteLanguages(content.settings).filter((language) => !language.main);
}

/** Where a page's translation into a language goes at first: the same address under the language's code. */
function translationAddress(page: Page, language: SiteLanguage): string {
  return page.path === "/" ? language.prefix : `${language.prefix}${page.path}`;
}

/** A page's state in a language, with what can be done about it. */
function TranslationStatus({
  state,
  language,
  onAdd,
  onMarkCurrent,
  editHref,
}: {
  state: "missing" | "current" | "outdated";
  language: SiteLanguage;
  onAdd: () => void;
  onMarkCurrent: () => void;
  editHref?: string;
}) {
  const t = useStrings();
  if (state === "missing") {
    return (
      <Button variant="ghost" onClick={onAdd}>
        {t("translations.add", { language: language.name })}
      </Button>
    );
  }
  return (
    <span className="gfa-translation">
      {editHref ? (
        <a href={editHref} className="gfa-link-strong" lang={language.code}>
          {language.name}
        </a>
      ) : (
        <span lang={language.code}>{language.name}</span>
      )}{" "}
      <span className={state === "outdated" ? "gfa-badge gfa-badge-warning" : "gfa-badge"}>
        {t(state === "outdated" ? "translations.outdated" : "translations.current")}
      </span>
      {state === "outdated" && (
        <Button variant="ghost" onClick={onMarkCurrent}>
          {t("translations.markCurrent")}
        </Button>
      )}
    </span>
  );
}

/** A page's translations on the Pages screen: each of the site's other languages, and how it stands. */
export function PageTranslations({ page }: { page: Page }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [adding, setAdding] = useState<SiteLanguage>();
  const [failure, setFailure] = useState<Failure>(null);
  if (!hasLanguages(content.settings)) return null;
  if (pageLanguage(content, page) !== mainLanguage(content.settings)) {
    const source = page.content.translationOf
      ? content.pages.find((candidate) => candidate.path === page.content.translationOf)
      : undefined;
    return source ? <span className="gfa-hint">{t("translations.of", { title: pageTitle(source) })}</span> : null;
  }
  const group = pageTranslations(content, page);
  const hash = pageSourceHash(page);
  const markCurrent = async (translation: Page) => {
    const result = await publish(
      [
        pageFileChange(translation.path, translation.content.data as Data, {
          ...translation.content,
          translatedFrom: hash,
        }),
      ],
      t("translations.markCurrentMessage", { title: pageTitle(translation) }),
    );
    if (!result.ok) setFailure(result);
  };
  return (
    <div className="gfa-translations">
      {otherLanguages(content).map((language) => {
        const translation = group.get(language.code);
        return (
          <TranslationStatus
            key={language.code}
            language={language}
            state={translationState(hash, translation?.content)}
            onAdd={() => setAdding(language)}
            onMarkCurrent={() => translation && void markCurrent(translation)}
            {...(translation && { editHref: pageEditorHref(translation.path) })}
          />
        );
      })}
      <PublishFailure failure={failure} />
      {adding && <AddPageTranslationDialog page={page} language={adding} onClose={() => setAdding(undefined)} />}
    </div>
  );
}

/** Makes a page's translation: a copy of it at an address in the language, which says what it translates. */
function AddPageTranslationDialog({
  page,
  language,
  onClose,
}: {
  page: Page;
  language: SiteLanguage;
  onClose: () => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [address, setAddress] = useState(() => translationAddress(page, language));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = pageTitle(page);

  const check = checkPageAddress(address, allPages(content));
  const inLanguage = check.ok && (check.path === language.prefix || check.path.startsWith(`${language.prefix}/`));
  const addressError = !submitted
    ? undefined
    : !check.ok
      ? t(addressErrors[check.problem])
      : !inLanguage
        ? t("translations.addressLanguage", { prefix: language.prefix, language: language.name })
        : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!check.ok || !inLanguage) return;
    setBusy(true);
    const result = await publish(
      [
        pageFileChange(check.path, page.content.data as Data, {
          translationOf: page.path,
          translatedFrom: pageSourceHash(page),
        }),
      ],
      t("translations.addMessage", { title, language: language.name }),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      // From the page editor, unpublished changes there are kept only if the editor chooses to stay.
      navigate(pageEditorHref(check.path), () => window.confirm(t("unsaved.confirm")));
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog title={t("translations.addTitle", { title, language: language.name })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <p className="gfa-hint">{t("translations.addHint", { language: language.name })}</p>
        <TextField label={t("newPage.address")} value={address} error={addressError} autoFocus onChange={setAddress} />
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : t("translations.addSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The changes that stop a page's translations naming it, for deleting it: they stay, as pages of their own. */
export function unlinkTranslations(content: SiteContent, page: Page) {
  return content.pages
    .filter((candidate) => candidate.content.translationOf === page.path)
    .map((translation) =>
      pageFileChange(translation.path, translation.content.data as Data, {
        ...translation.content,
        translationOf: undefined,
        translatedFrom: undefined,
      }),
    );
}

/** An item's translations in a collection's list: each of the site's other languages, and how it stands. */
export function EntryTranslations({
  collection,
  entry,
  entryHref,
}: {
  collection: Collection;
  entry: Entry;
  entryHref: (slug: string) => string;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [adding, setAdding] = useState<SiteLanguage>();
  const [failure, setFailure] = useState<Failure>(null);
  const { settings } = content;
  if (!hasLanguages(settings)) return null;
  const language = entry.content.inLanguage ?? mainLanguage(settings);
  if (language !== mainLanguage(settings)) {
    const name = siteLanguages(settings).find((candidate) => candidate.code === language)?.name ?? language;
    const source = entry.content.translationOf
      ? collection.entries.find((candidate) => candidate.slug === entry.content.translationOf)
      : undefined;
    return (
      <span className="gfa-hint">
        {source
          ? t("translations.entryOf", { language: name, title: entryLabel(source) })
          : t("translations.inLanguage", { language: name })}
      </span>
    );
  }
  const group = entryTranslations(settings, collection, entry);
  const hash = entrySourceHash(entry);
  const markCurrent = async (translation: Entry) => {
    const result = await publish(
      [
        entryFileChange(collection, translation.slug, translation.content.fields, {
          ...translation.content,
          translatedFrom: hash,
        }),
      ],
      t("translations.markCurrentMessage", { title: entryLabel(translation) }),
    );
    if (!result.ok) setFailure(result);
  };
  return (
    <div className="gfa-translations">
      {otherLanguages(content).map((other) => {
        const translation = group.get(other.code);
        return (
          <TranslationStatus
            key={other.code}
            language={other}
            state={translationState(hash, translation?.content)}
            onAdd={() => setAdding(other)}
            onMarkCurrent={() => translation && void markCurrent(translation)}
            {...(translation && { editHref: entryHref(translation.slug) })}
          />
        );
      })}
      <PublishFailure failure={failure} />
      {adding && (
        <AddEntryTranslationDialog
          collection={collection}
          entry={entry}
          language={adding}
          entryHref={entryHref}
          onClose={() => setAdding(undefined)}
        />
      )}
    </div>
  );
}

function entryLabel(entry: Entry): string {
  const title = entry.content.fields.title;
  return typeof title === "string" && title.trim() ? title.trim() : entry.slug;
}

/** Makes an item's translation: a copy of its values, with a name of its own, in the language. */
function AddEntryTranslationDialog({
  collection,
  entry,
  language,
  entryHref,
  onClose,
}: {
  collection: Collection;
  entry: Entry;
  language: SiteLanguage;
  entryHref: (slug: string) => string;
  onClose: () => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [slug, setSlug] = useState(`${entry.slug}-${language.code.toLowerCase()}`);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = entryLabel(entry);
  const check = checkEntrySlug(
    slug,
    collection,
    allPages(content).map((page) => page.path),
    undefined,
    { settings: content.settings, code: language.code },
  );
  const slugError = submitted && !check.ok ? t(nameErrors[check.problem]) : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!check.ok) return;
    setBusy(true);
    const result = await publish(
      [
        entryFileChange(collection, check.slug, entry.content.fields, {
          inLanguage: language.code,
          translationOf: entry.slug,
          translatedFrom: entrySourceHash(entry),
        }),
      ],
      t("translations.addMessage", { title, language: language.name }),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      navigate(entryHref(check.slug), () => window.confirm(t("unsaved.confirm")));
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog title={t("translations.addTitle", { title, language: language.name })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <p className="gfa-hint">{t("translations.addHint", { language: language.name })}</p>
        <TextField
          label={t("newEntry.address")}
          hint={check.ok && check.path ? t("newEntry.addressHint", { example: check.path }) : undefined}
          value={slug}
          error={slugError}
          autoFocus
          onChange={setSlug}
        />
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : t("translations.addSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The changes that stop an item's translations naming it, for deleting it. */
export function unlinkEntryTranslations(collection: Collection, entry: Entry) {
  return collection.entries
    .filter((candidate) => candidate.content.translationOf === entry.slug)
    .map((translation) =>
      entryFileChange(collection, translation.slug, translation.content.fields, {
        ...translation.content,
        translationOf: undefined,
        translatedFrom: undefined,
      }),
    );
}

/** One of the site's languages in an editor's language menu: its translation, if it has one. */
interface LanguageChoice {
  language: SiteLanguage;
  href?: string;
  outdated: boolean;
}

/**
 * The menu of languages in an editor's header, like the Header & Footer
 * editor's, so it stays one control however many languages the site has.
 * Choosing a language opens its translation, or offers to make one.
 */
function TranslationMenu({
  own,
  choices,
  onAdd,
}: {
  own: SiteLanguage;
  choices: LanguageChoice[];
  onAdd: (language: SiteLanguage) => void;
}) {
  const t = useStrings();
  const choose = (code: string) => {
    const choice = choices.find((candidate) => candidate.language.code === code);
    if (!choice) return;
    if (choice.href) navigate(choice.href, () => window.confirm(t("unsaved.confirm")));
    else onAdd(choice.language);
  };
  return (
    <label className="gfa-inline-field">
      {t("menus.language")}
      <select className="gfa-input" value={own.code} onChange={(event) => choose(event.target.value)}>
        <option value={own.code} lang={own.code}>
          {own.name}
        </option>
        {choices.map(({ language, href, outdated }) => (
          <option key={language.code} value={language.code} lang={href ? language.code : undefined}>
            {href
              ? outdated
                ? t("translations.optionOutdated", { language: language.name })
                : language.name
              : t("translations.optionAdd", { language: language.name })}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * In the page editor's header, on a site in several languages: a menu of the
 * site's languages, to open the page's translation in one or make one.
 * A page in another language that translates nothing has none.
 */
export function PageEditorTranslations({ page }: { page: Page }) {
  const { content } = useSiteContent();
  const [adding, setAdding] = useState<SiteLanguage>();
  if (!hasLanguages(content.settings)) return null;
  const main = mainLanguage(content.settings);
  const own = pageLanguage(content, page);
  const source = own === main ? page : content.pages.find((candidate) => candidate.path === page.content.translationOf);
  if (!source || pageLanguage(content, source) !== main) return null;
  const group = pageTranslations(content, source);
  const hash = pageSourceHash(source);
  const languages = siteLanguages(content.settings);
  const current = languages.find((language) => language.code === own);
  if (!current) return null;
  const choices = languages
    .filter((language) => language.code !== own)
    .map((language) => {
      const translation = group.get(language.code);
      return {
        language,
        href: translation && pageEditorHref(translation.path),
        outdated: !!translation && !language.main && translationState(hash, translation.content) === "outdated",
      };
    });
  return (
    <>
      <TranslationMenu own={current} choices={choices} onAdd={setAdding} />
      {adding && <AddPageTranslationDialog page={source} language={adding} onClose={() => setAdding(undefined)} />}
    </>
  );
}

/** The same in the item editor's header, for an item's translations. */
export function EntryEditorTranslations({ collection, entry }: { collection: Collection; entry: Entry }) {
  const { content } = useSiteContent();
  const [adding, setAdding] = useState<SiteLanguage>();
  const { settings } = content;
  if (!hasLanguages(settings)) return null;
  const main = mainLanguage(settings);
  const own = entry.content.inLanguage ?? main;
  const source =
    own === main ? entry : collection.entries.find((candidate) => candidate.slug === entry.content.translationOf);
  if (!source || (source.content.inLanguage ?? main) !== main) return null;
  const group = entryTranslations(settings, collection, source);
  const hash = entrySourceHash(source);
  const entryHref = (slug: string) => entryEditorHref(collection.id, slug);
  const languages = siteLanguages(settings);
  const current = languages.find((language) => language.code === own);
  if (!current) return null;
  const choices = languages
    .filter((language) => language.code !== own)
    .map((language) => {
      const translation = group.get(language.code);
      return {
        language,
        href: translation && entryHref(translation.slug),
        outdated: !!translation && !language.main && translationState(hash, translation.content) === "outdated",
      };
    });
  return (
    <>
      <TranslationMenu own={current} choices={choices} onAdd={setAdding} />
      {adding && (
        <AddEntryTranslationDialog
          collection={collection}
          entry={source}
          language={adding}
          entryHref={entryHref}
          onClose={() => setAdding(undefined)}
        />
      )}
    </>
  );
}
