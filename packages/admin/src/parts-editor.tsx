import { useMemo, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { useStrings } from "./strings.js";
import { Field, TextField } from "./ui.js";

/**
 * Classes for blocks' named parts (`theme.parts`), a block at a time: the
 * blocks and their parts come from the site's description, since the admin
 * panel's page never loads blocks' code. A part several blocks share, such as
 * a list's page links, has the same classes in each.
 */
export function PartsEditor({
  parts,
  errors,
  onChange,
}: {
  parts: Readonly<Record<string, string>> | undefined;
  errors: Record<string, string>;
  onChange: (parts: Record<string, string> | undefined) => void;
}) {
  const t = useStrings();
  const { site } = useAdmin();
  const blocks = useMemo(
    () =>
      Object.entries(site.description.blocks)
        .flatMap(([name, block]) =>
          block.parts && Object.keys(block.parts).length > 0
            ? [{ name, label: block.label ?? name, parts: block.parts }]
            : [],
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
    [site.description.blocks],
  );
  const [chosen, setChosen] = useState(blocks[0]?.name ?? "");
  const block = blocks.find((candidate) => candidate.name === chosen) ?? blocks[0];

  if (!block) return <p className="gfa-hint">{t("theme.partsNone")}</p>;

  const setPart = (name: string, classes: string) => {
    const next = { ...parts };
    if (classes.trim()) next[name] = classes;
    else delete next[name];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const styled = (names: string[]) => names.filter((name) => parts?.[name]?.trim()).length;

  return (
    <>
      <Field label={t("theme.partsBlock")}>
        {(props) => (
          <select
            {...props}
            className="gfa-input"
            value={block.name}
            onChange={(event) => setChosen(event.target.value)}
          >
            {blocks.map((candidate) => {
              const count = styled(Object.keys(candidate.parts));
              return (
                <option key={candidate.name} value={candidate.name}>
                  {count > 0
                    ? t("theme.partsBlockStyled", { block: candidate.label, count: String(count) })
                    : candidate.label}
                </option>
              );
            })}
          </select>
        )}
      </Field>
      {Object.entries(block.parts).map(([name, label]) => (
        <TextField
          key={name}
          label={label}
          hint={t("theme.partsName", { name })}
          value={parts?.[name] ?? ""}
          error={errors[`theme.parts.${name}`]}
          onChange={(classes) => setPart(name, classes)}
        />
      ))}
    </>
  );
}
