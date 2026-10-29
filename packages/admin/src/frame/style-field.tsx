/**
 * A block's Style field (`classNameField` in `@goodfellow-cms/react`), which
 * Puck's editor shows as controls for its look in place of a box of classes:
 * text alignment, size and color, background, space inside and around it,
 * rounded corners and the sizes of screen it's hidden on, written into its `className` as Tailwind classes
 * (`withBlockStyle()` in `@goodfellow-cms/core`), with any other classes kept.
 */
import {
  type BlockStyle,
  colorSlug,
  contrastRatio,
  customLength,
  DEFAULT_THEME_COLORS,
  FONT_SIZES,
  isCustomColor,
  MINIMUM_CONTRAST,
  RADII,
  readBlockStyle,
  SCREEN_SIZES,
  type ScreenSize,
  SIDES,
  type Side,
  type Sides,
  SPACING_STEPS,
  TEXT_ALIGNS,
  THEME_COLORS,
  type ThemeColor,
  themeColorOf,
  withBlockStyle,
} from "@goodfellow-cms/core";
import { isStyleField } from "@goodfellow-cms/react";
import type { ComponentConfig, Config, CustomField, Field, Fields } from "@puckeditor/core";
import { useEffect, useId, useState } from "react";
import { type StringKey, useStrings } from "../strings.js";

/** The theme's colors, by name, as the site has them. */
export type StyleColors = Partial<Record<ThemeColor, string>>;

type Translate = ReturnType<typeof useStrings>;

/** A color's value to show and compare: a theme color's, or the editor's own. */
function shownColor(value: string | undefined, colors: StyleColors): string | undefined {
  if (!value) return undefined;
  const theme = themeColorOf(value);
  return theme ? (colors[theme] ?? DEFAULT_THEME_COLORS[theme]) : value;
}

/**
 * A choice from a scale, or a size of the editor's own: the scale's steps,
 * "As the block has it" and "Your own…", which shows a box for a length.
 */
function ScaleChoice({
  label,
  value,
  steps,
  stepLabel,
  readOnly,
  onChange,
}: {
  label: string;
  value: string | undefined;
  steps: readonly string[];
  stepLabel: (step: string) => string;
  readOnly?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const t = useStrings();
  const id = useId();
  const custom = value !== undefined && !steps.includes(value);
  const [ownChosen, setOwnChosen] = useState(custom);
  const [typed, setTyped] = useState(custom ? value : "");
  useEffect(() => {
    if (value !== undefined && !steps.includes(value)) {
      setOwnChosen(true);
      setTyped(value);
    }
  }, [value, steps]);
  const own = custom || ownChosen;
  const invalid = own && typed.trim() !== "" && customLength(typed) === undefined;
  return (
    <div className="gfa-style-choice">
      <label className="gfa-style-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="gfa-input"
        disabled={readOnly}
        value={own ? "custom" : (value ?? "")}
        onChange={(event) => {
          const chosen = event.target.value;
          if (chosen === "custom") {
            setOwnChosen(true);
            const length = customLength(typed);
            if (length) onChange(length);
            return;
          }
          setOwnChosen(false);
          onChange(chosen === "" ? undefined : chosen);
        }}
      >
        <option value="">{t("style.default")}</option>
        {steps.map((step) => (
          <option key={step} value={step}>
            {stepLabel(step)}
          </option>
        ))}
        <option value="custom">{t("style.custom")}</option>
      </select>
      {own && (
        <input
          className="gfa-input"
          value={typed}
          readOnly={readOnly}
          aria-label={`${label}: ${t("style.customLength")}`}
          placeholder={t("style.customLength")}
          aria-invalid={invalid}
          onChange={(event) => {
            setTyped(event.target.value);
            const length = customLength(event.target.value);
            if (length) onChange(length);
          }}
        />
      )}
      {invalid && <p className="gfa-error-text">{t("style.customLengthInvalid")}</p>}
    </div>
  );
}

/** Spacing steps as people read them: `4` is 16px. */
function spacingLabel(t: Translate, step: string): string {
  return step === "0" ? t("style.none") : `${Number(step) * 4}px`;
}

/** Space on every side at once, or on each side. */
function SidesChoice({
  label,
  sides,
  readOnly,
  onChange,
}: {
  label: string;
  sides: Sides | undefined;
  readOnly?: boolean;
  onChange: (sides: Sides | undefined) => void;
}) {
  const t = useStrings();
  const values = SIDES.map((side) => sides?.[side]);
  const same = values.every((value) => value === values[0]);
  const [each, setEach] = useState(!same);
  useEffect(() => {
    if (!same) setEach(true);
  }, [same]);
  const set = (next: Sides) => {
    const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as Sides;
    onChange(Object.keys(kept).length > 0 ? kept : undefined);
  };
  const stepLabel = (step: string) => spacingLabel(t, step);
  return (
    <fieldset className="gfa-style-group">
      <legend className="gfa-style-label">{label}</legend>
      {each ? (
        <div className="gfa-style-sides">
          {SIDES.map((side: Side) => (
            <ScaleChoice
              key={side}
              label={t(`style.side.${side}` as StringKey)}
              value={sides?.[side]}
              steps={SPACING_STEPS}
              stepLabel={stepLabel}
              readOnly={readOnly}
              onChange={(value) => set({ ...sides, [side]: value })}
            />
          ))}
        </div>
      ) : (
        <ScaleChoice
          label={t("style.allSides")}
          value={values[0]}
          steps={SPACING_STEPS}
          stepLabel={stepLabel}
          readOnly={readOnly}
          onChange={(value) => set(Object.fromEntries(SIDES.map((side) => [side, value])) as Sides)}
        />
      )}
      <label className="gfa-style-check">
        <input
          type="checkbox"
          checked={each}
          disabled={readOnly || (each && !same)}
          onChange={(event) => setEach(event.target.checked)}
        />
        {t("style.eachSide")}
      </label>
    </fieldset>
  );
}

/** The theme's colors as swatches, a color of the editor's own, and back to the block's. */
function ColorChoice({
  label,
  value,
  colors,
  readOnly,
  onChange,
}: {
  label: string;
  value: string | undefined;
  colors: StyleColors;
  readOnly?: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const t = useStrings();
  const own = value !== undefined && isCustomColor(value);
  return (
    <fieldset className="gfa-style-group">
      <legend className="gfa-style-label">{label}</legend>
      <div className="gfa-style-swatches">
        <button
          type="button"
          className="gfa-style-swatch gfa-style-swatch-none"
          aria-pressed={value === undefined}
          disabled={readOnly}
          title={t("style.colorDefault")}
          aria-label={t("style.colorDefault")}
          onClick={() => onChange(undefined)}
        />
        {THEME_COLORS.map((color) => {
          const slug = colorSlug(color);
          const name = t(`theme.color.${color}` as StringKey);
          return (
            <button
              key={color}
              type="button"
              className="gfa-style-swatch"
              style={{ background: colors[color] ?? DEFAULT_THEME_COLORS[color] }}
              aria-pressed={value === slug}
              disabled={readOnly}
              title={name}
              aria-label={name}
              onClick={() => onChange(slug)}
            />
          );
        })}
        <label className="gfa-style-swatch gfa-style-swatch-own" title={t("style.colorCustom")}>
          <input
            type="color"
            value={own ? value : "#000000"}
            disabled={readOnly}
            aria-label={`${label}: ${t("style.colorCustom")}`}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** The sizes of screen a block is hidden on, a box for each. */
function HiddenOnChoice({
  hiddenOn,
  readOnly,
  onChange,
}: {
  hiddenOn: readonly ScreenSize[] | undefined;
  readOnly?: boolean;
  onChange: (hiddenOn: ScreenSize[] | undefined) => void;
}) {
  const t = useStrings();
  const hidden = new Set(hiddenOn);
  return (
    <fieldset className="gfa-style-group">
      <legend className="gfa-style-label">{t("style.hiddenOn")}</legend>
      {SCREEN_SIZES.map((size) => (
        <label key={size} className="gfa-style-check">
          <input
            type="checkbox"
            checked={hidden.has(size)}
            disabled={readOnly}
            onChange={(event) => {
              const next = SCREEN_SIZES.filter((candidate) =>
                candidate === size ? event.target.checked : hidden.has(candidate),
              );
              onChange(next.length > 0 ? next : undefined);
            }}
          />
          {t(`style.hiddenOn.${size}` as StringKey)}
        </label>
      ))}
      {hidden.size > 0 && (
        <p className="gfa-hint">
          {t(hidden.size === SCREEN_SIZES.length ? "style.hiddenOnAll" : "style.hiddenOnHint")}
        </p>
      )}
    </fieldset>
  );
}

/** Other classes, kept as typed while the box has focus, so a class isn't taken into the controls halfway. */
function OtherClasses({
  other,
  readOnly,
  onChange,
}: {
  other: readonly string[];
  readOnly?: boolean;
  onChange: (other: string[]) => void;
}) {
  const t = useStrings();
  const id = useId();
  const joined = other.join(" ");
  const [typed, setTyped] = useState(joined);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setTyped(joined);
  }, [joined, focused]);
  return (
    <div className="gfa-style-choice">
      <label className="gfa-style-label" htmlFor={id}>
        {t("style.other")}
      </label>
      <input
        id={id}
        className="gfa-input gfa-code"
        value={typed}
        readOnly={readOnly}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(event.target.value.split(/\s+/).filter(Boolean));
        }}
      />
      <p className="gfa-hint">{t("style.otherHint")}</p>
    </div>
  );
}

function StyleControls({
  value,
  colors,
  readOnly,
  label,
  ownAlign,
  block,
  onChange,
}: {
  value: unknown;
  colors: StyleColors;
  readOnly?: boolean;
  label?: string;
  /** Whether the block has an alignment setting of its own, which the style then leaves to it. */
  ownAlign: boolean;
  /** A block's, rather than the page's, which can't be hidden. */
  block: boolean;
  onChange: (value: string) => void;
}) {
  const t = useStrings();
  const { style, other } = readBlockStyle(value);
  const set = (next: BlockStyle) => onChange(withBlockStyle(other, next));
  const change = <K extends keyof BlockStyle>(key: K, next: BlockStyle[K]) => {
    const { [key]: _old, ...rest } = style;
    set(next === undefined ? rest : { ...rest, [key]: next });
  };
  const text = shownColor(style.color, colors);
  const background = shownColor(style.background, colors);
  const ratio = text && background ? contrastRatio(text, background) : undefined;
  return (
    <div className="gfa-style-field">
      {label && <div className="gfa-style-title">{label}</div>}
      {!ownAlign && (
        <fieldset className="gfa-style-group">
          <legend className="gfa-style-label">{t("style.align")}</legend>
          <div className="gfa-style-segments">
            {[undefined, ...TEXT_ALIGNS].map((align) => (
              <button
                key={align ?? "default"}
                type="button"
                className="gfa-style-segment"
                aria-pressed={style.align === align}
                disabled={readOnly}
                onClick={() => change("align", align)}
              >
                {t(`style.align.${align ?? "default"}` as StringKey)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <ScaleChoice
        label={t("style.fontSize")}
        value={style.fontSize}
        steps={FONT_SIZES}
        stepLabel={(step) => t(`style.fontSize.${step}` as StringKey)}
        readOnly={readOnly}
        onChange={(size) => change("fontSize", size)}
      />
      <ColorChoice
        label={t("style.color")}
        value={style.color}
        colors={colors}
        readOnly={readOnly}
        onChange={(color) => change("color", color)}
      />
      <ColorChoice
        label={t("style.background")}
        value={style.background}
        colors={colors}
        readOnly={readOnly}
        onChange={(color) => change("background", color)}
      />
      {ratio !== undefined && ratio < MINIMUM_CONTRAST && (
        <p className="gfa-hint gfa-style-warning" role="status">
          {t("style.contrast")}
        </p>
      )}
      <SidesChoice
        label={t("style.padding")}
        sides={style.padding}
        readOnly={readOnly}
        onChange={(sides) => change("padding", sides)}
      />
      <SidesChoice
        label={t("style.margin")}
        sides={style.margin}
        readOnly={readOnly}
        onChange={(sides) => change("margin", sides)}
      />
      <ScaleChoice
        label={t("style.radius")}
        value={style.radius}
        steps={RADII}
        stepLabel={(step) => t(`style.radius.${step}` as StringKey)}
        readOnly={readOnly}
        onChange={(radius) => change("radius", radius)}
      />
      {(block || style.hiddenOn) && (
        <HiddenOnChoice
          hiddenOn={style.hiddenOn}
          readOnly={readOnly}
          onChange={(hiddenOn) => change("hiddenOn", hiddenOn)}
        />
      )}
      <OtherClasses other={other} readOnly={readOnly} onChange={(next) => onChange(withBlockStyle(next, style))} />
      <button
        type="button"
        className="gfa-button gfa-button-secondary"
        disabled={readOnly || (Object.keys(style).length === 0 && other.length === 0)}
        onClick={() => onChange("")}
      >
        {t("style.reset")}
      </button>
    </div>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: Puck fields hold any value
type AnyField = Field<any>;
// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
type AnyComponent = ComponentConfig<any>;

function withStyleField(field: AnyField, colors: StyleColors, ownAlign: boolean, block: boolean): AnyField {
  if (field.type !== "text" || !isStyleField(field)) return field;
  const render: CustomField<string>["render"] = ({ value, onChange, readOnly }) => (
    <StyleControls
      value={value}
      colors={colors}
      readOnly={readOnly}
      label={field.label}
      ownAlign={ownAlign}
      block={block}
      onChange={onChange}
    />
  );
  return { type: "custom", label: field.label, metadata: field.metadata, render } as AnyField;
}

function withStyleFieldsIn(fields: Fields | undefined, colors: StyleColors, block: boolean): Fields | undefined {
  if (!fields) return fields;
  const ownAlign = "align" in fields;
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, withStyleField(field as AnyField, colors, ownAlign, block)]),
  ) as Fields;
}

function withStyleComponent<T extends AnyComponent | Config["root"]>(
  component: T,
  colors: StyleColors,
  block: boolean,
): T {
  if (!component) return component;
  const { resolveFields } = component as AnyComponent;
  return {
    ...component,
    ...(component.fields && { fields: withStyleFieldsIn(component.fields as Fields, colors, block) }),
    ...(resolveFields && {
      resolveFields: async (...args: Parameters<NonNullable<AnyComponent["resolveFields"]>>) =>
        withStyleFieldsIn(await resolveFields(...args), colors, block) as Fields,
    }),
  };
}

/** The config with every block's Style field, and the page's, drawn as a style's controls. */
export function withStyleFields(config: Config, colors: StyleColors): Config {
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, component]) => [name, withStyleComponent(component, colors, true)]),
  );
  return {
    ...config,
    components,
    ...(config.root && { root: withStyleComponent(config.root, colors, false) }),
  } as Config;
}
