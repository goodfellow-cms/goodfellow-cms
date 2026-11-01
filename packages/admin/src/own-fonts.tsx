/**
 * The site's own fonts on the Colors & fonts tab: the list, Remove, and the
 * Add a font dialog, which checks each WOFF2 file (its bytes, its size, and
 * that this browser can read it as a font) and asks the owner to confirm
 * they're allowed to use it on a website. What it adds goes into the tab's
 * draft, with the files' bytes, and is published with the rest of the tab
 * (`customFontFileChanges()`).
 */
import {
  type CustomFont,
  type CustomFontFile,
  customFont,
  FONT_CATEGORIES,
  type FontCategory,
  fontFileName,
  guessFontFamily,
  guessFontFile,
  isWoff2,
  MAX_CUSTOM_FONTS,
  MAX_FONT_BYTES,
  MAX_FONT_FILES,
  type Theme,
} from "@goodfellow-cms/core";
import { useEffect, useId, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { installCustomFonts } from "./custom-font-faces.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, docsLink, Field, InfoBubble, TextField } from "./ui.js";

/** Where the documentation says what fonts sites may use, which the license checkbox links to. */
export const FONT_LICENSE_DOCS = docsLink("layout-and-settings", "your-own-fonts");

/** A font's family name, as the schema takes it. */
const FAMILY = /^[a-zA-Z0-9 ]{1,60}$/;

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const VARIABLE = "variable";

/** The bytes of files added since the tab was loaded, by path, which go out with the tab's Publish. */
export type AddedFontFiles = Record<string, Uint8Array>;

/** Shows the site's own fonts in the admin panel's page, so the font menus and the list show each in its own face. */
export function useOwnFontsShown(theme: Theme, added: AddedFontFiles): void {
  const { mediaPreviews } = useAdmin();
  const fonts = theme.fonts.custom;
  useEffect(() => {
    installCustomFonts(document, fonts ?? [], async (url) => added[`public${url}`] ?? mediaPreviews.bytes(url));
  }, [fonts, added, mediaPreviews]);
}

/** The list of the site's own fonts, with Remove and Add a font. */
export function OwnFonts({
  theme,
  onChange,
  onAdd,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
  /** A font added, with its files' bytes by path. */
  onAdd: (font: CustomFont, files: AddedFontFiles) => void;
}) {
  const t = useStrings();
  const [adding, setAdding] = useState(false);
  const fonts = theme.fonts.custom ?? [];

  const remove = (family: string) => {
    const custom = fonts.filter((font) => font.family !== family);
    const { custom: _old, ...rest } = theme.fonts;
    // Headings and text that used it go back to the site default.
    const heading = rest.heading === family ? undefined : rest.heading;
    const body = rest.body === family ? undefined : rest.body;
    onChange({
      ...theme,
      fonts: {
        ...rest,
        ...(heading === undefined ? { heading: undefined, headingCategory: undefined } : {}),
        ...(body === undefined ? { body: undefined, bodyCategory: undefined } : {}),
        ...(custom.length > 0 && { custom }),
      },
    });
  };

  return (
    <section aria-labelledby="gfa-own-fonts">
      <h3 className="gfa-label" id="gfa-own-fonts">
        {t("theme.ownFonts")}
      </h3>
      <p className="gfa-hint">{t("theme.ownFontsHint")}</p>
      {fonts.length === 0 ? (
        <p className="gfa-hint">{t("theme.noOwnFonts")}</p>
      ) : (
        <ul className="gfa-own-fonts">
          {fonts.map((font) => (
            <li key={font.family} className="gfa-own-font">
              <span className="gfa-own-font-name" style={{ fontFamily: `"${font.family}", system-ui, sans-serif` }}>
                {font.family}
              </span>
              <span className="gfa-hint">{t("theme.ownFontFiles", { count: String(font.files.length) })}</span>
              <Button
                variant="ghost"
                aria-label={t("theme.removeFontLabel", { family: font.family })}
                onClick={() => remove(font.family)}
              >
                {t("theme.removeFont")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => setAdding(true)} disabled={fonts.length >= MAX_CUSTOM_FONTS}>
        {t("theme.addFont")}
      </Button>
      {fonts.length >= MAX_CUSTOM_FONTS && (
        <p className="gfa-hint">{t("font.add.full", { count: String(MAX_CUSTOM_FONTS) })}</p>
      )}
      {adding && (
        <AddFontDialog
          theme={theme}
          onClose={() => setAdding(false)}
          onAdd={(font, files) => {
            onAdd(font, files);
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

/** One file chosen in the dialog, with what was found out about it. */
interface ChosenFile {
  key: string;
  name: string;
  bytes?: Uint8Array;
  weight: number;
  weightTo?: number;
  style: "normal" | "italic";
  problem?: { key: StringKey; name: string };
}

/** Reads and checks a chosen file: WOFF2 by its bytes, small enough, and readable as a font by this browser. */
async function checkFile(file: File, index: number): Promise<ChosenFile> {
  const guess = guessFontFile(file.name);
  const chosen: ChosenFile = {
    key: `${index}-${file.name}`,
    name: file.name,
    weight: guess.weight,
    ...(guess.weightTo && { weightTo: guess.weightTo }),
    style: guess.style ?? "normal",
  };
  if (file.size > MAX_FONT_BYTES) return { ...chosen, problem: { key: "font.add.tooLarge", name: file.name } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isWoff2(bytes)) return { ...chosen, problem: { key: "font.add.notWoff2", name: file.name } };
  try {
    await new FontFace("Goodfellow font check", bytes.slice().buffer).load();
  } catch {
    return { ...chosen, problem: { key: "font.add.unreadable", name: file.name } };
  }
  return { ...chosen, bytes };
}

/** The problem that keeps the font from being added, if there is one. */
function addProblem(
  t: ReturnType<typeof useStrings>,
  theme: Theme,
  family: string,
  files: ChosenFile[],
  allowed: boolean,
): string | undefined {
  const fileProblem = files.find((file) => file.problem)?.problem;
  if (fileProblem) return t(fileProblem.key, { name: fileProblem.name });
  if (!FAMILY.test(family)) return t("font.add.familyInvalid");
  if (customFont(theme, family)) return t("font.add.familyTaken", { family });
  if (files.length > MAX_FONT_FILES) return t("font.add.tooMany", { count: String(MAX_FONT_FILES) });
  const kinds = files.map((file) => `${file.weight}-${file.weightTo ?? ""}-${file.style}`);
  if (new Set(kinds).size !== kinds.length) return t("font.add.duplicate");
  if (!allowed) return t("font.add.needAllowed");
  return undefined;
}

function AddFontDialog({
  theme,
  onClose,
  onAdd,
}: {
  theme: Theme;
  onClose: () => void;
  onAdd: (font: CustomFont, files: AddedFontFiles) => void;
}) {
  const t = useStrings();
  const id = useId();
  const [files, setFiles] = useState<ChosenFile[]>([]);
  const [checking, setChecking] = useState(false);
  const [family, setFamily] = useState("");
  const [category, setCategory] = useState<FontCategory>("sans-serif");
  const [allowed, setAllowed] = useState(false);
  const [tried, setTried] = useState(false);

  const choose = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setChecking(true);
    const chosen = await Promise.all([...list].map((file, index) => checkFile(file, index)));
    setChecking(false);
    setFiles(chosen);
    if (!family) setFamily(guessFontFamily(chosen[0]?.name ?? ""));
  };

  const name = family.trim().replace(/\s+/g, " ");
  const problem = files.length > 0 ? addProblem(t, theme, name, files, allowed) : undefined;
  const update = (key: string, change: Partial<ChosenFile>) =>
    setFiles((current) => current.map((file) => (file.key === key ? { ...file, ...change } : file)));

  const add = () => {
    setTried(true);
    if (problem || files.length === 0) return;
    const added: AddedFontFiles = {};
    const fontFiles: CustomFontFile[] = files.map((file) => {
      const shape = {
        weight: file.weight,
        ...(file.weightTo && { weightTo: file.weightTo }),
        ...(file.style === "italic" && { style: "italic" as const }),
      };
      const src = `/media/fonts/${fontFileName(name, shape)}`;
      if (file.bytes) added[`public${src}`] = file.bytes;
      return { src, ...shape };
    });
    onAdd({ family: name, category, files: fontFiles }, added);
  };

  return (
    <Dialog title={t("font.add.title")} onClose={onClose}>
      <Field label={t("font.add.files")} hint={t("font.add.filesHint")}>
        {(props) => (
          <input
            {...props}
            type="file"
            accept=".woff2,font/woff2"
            multiple
            onChange={(event) => void choose(event.target.files)}
          />
        )}
      </Field>
      {checking && <p className="gfa-hint">{t("font.add.checking")}</p>}
      {files.length > 0 && (
        <>
          <table className="gfa-font-files">
            <thead>
              <tr>
                <th scope="col">{t("font.add.file")}</th>
                <th scope="col">{t("font.add.weight")}</th>
                <th scope="col">{t("font.add.style")}</th>
                <th scope="col">
                  <span className="gfa-visually-hidden">{t("theme.removeFont")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.key}>
                  <td>{file.name}</td>
                  <td>
                    <select
                      className="gfa-input"
                      aria-label={`${t("font.add.weight")}: ${file.name}`}
                      value={file.weightTo ? VARIABLE : String(file.weight)}
                      onChange={(event) =>
                        update(
                          file.key,
                          event.target.value === VARIABLE
                            ? { weight: 100, weightTo: 900 }
                            : { weight: Number(event.target.value), weightTo: undefined },
                        )
                      }
                    >
                      {WEIGHTS.map((weight) => (
                        <option key={weight} value={weight}>
                          {t(`font.weight.${weight}` as StringKey)}
                        </option>
                      ))}
                      <option value={VARIABLE}>{t("font.weight.variable")}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="gfa-input"
                      aria-label={`${t("font.add.style")}: ${file.name}`}
                      value={file.style}
                      onChange={(event) => update(file.key, { style: event.target.value as ChosenFile["style"] })}
                    >
                      <option value="normal">{t("font.add.upright")}</option>
                      <option value="italic">{t("font.add.italic")}</option>
                    </select>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      aria-label={t("font.add.removeFile", { name: file.name })}
                      onClick={() => setFiles((current) => current.filter((other) => other.key !== file.key))}
                    >
                      {t("theme.removeFont")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TextField label={t("font.add.family")} hint={t("font.add.familyHint")} value={family} onChange={setFamily} />
          <Field label={t("font.add.category")} hint={t("font.add.categoryHint")}>
            {(props) => (
              <select
                {...props}
                className="gfa-input"
                value={category}
                onChange={(event) => setCategory(event.target.value as FontCategory)}
              >
                {FONT_CATEGORIES.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`font.category.${kind}` as StringKey)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      <div className="gfa-checkbox">
        <input
          id={`${id}-allowed`}
          type="checkbox"
          checked={allowed}
          onChange={(event) => setAllowed(event.target.checked)}
        />
        <label htmlFor={`${id}-allowed`}>{t("font.add.allowed")}</label>
        <InfoBubble label={t("font.add.allowedInfo")} text={t("font.add.allowedTip")} href={FONT_LICENSE_DOCS} />
      </div>
      {(tried || files.some((file) => file.problem)) && problem && (
        <p className="gfa-error-text" role="alert">
          {problem}
        </p>
      )}
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="primary" disabled={checking || files.length === 0} onClick={add}>
          {t("font.add.button")}
        </Button>
      </div>
    </Dialog>
  );
}
