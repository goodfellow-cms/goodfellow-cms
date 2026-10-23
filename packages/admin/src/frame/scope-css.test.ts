import { describe, expect, it } from "vitest";
import { scopeCss, scopeSelector } from "./scope-css.js";

describe("scopeSelector", () => {
  it("keeps selectors to the canvas", () => {
    expect(scopeSelector(".card > h2")).toBe(".gf-canvas :is(.card > h2)");
    expect(scopeSelector("*")).toBe(".gf-canvas :is(*)");
  });

  it("makes the page itself the canvas", () => {
    expect(scopeSelector(":root")).toBe(".gf-canvas");
    expect(scopeSelector("html")).toBe(".gf-canvas");
    expect(scopeSelector("body")).toBe(".gf-canvas");
    expect(scopeSelector("html body .x")).toBe(".gf-canvas .x");
    expect(scopeSelector(":root .x")).toBe(".gf-canvas .x");
  });

  it("keeps what's said about the page on the page", () => {
    expect(scopeSelector(':root[data-gf-color-scheme="dark"]')).toBe(':root[data-gf-color-scheme="dark"] .gf-canvas');
    expect(scopeSelector(':root:not([data-gf-color-scheme="light"])')).toBe(
      ':root:not([data-gf-color-scheme="light"]) .gf-canvas',
    );
    expect(scopeSelector("html.dark p")).toBe(":root.dark .gf-canvas p");
  });

  it("leaves selectors that only start like the page's alone", () => {
    expect(scopeSelector("htmlish")).toBe(".gf-canvas :is(htmlish)");
    expect(scopeSelector(".body")).toBe(".gf-canvas :is(.body)");
  });

  it("keeps pseudo-elements outside :is()", () => {
    expect(scopeSelector("a::before")).toBe(".gf-canvas :is(a)::before");
    expect(scopeSelector("::after")).toBe(".gf-canvas ::after");
    expect(scopeSelector("input::placeholder")).toBe(".gf-canvas :is(input)::placeholder");
  });

  it("lets ancestors outside the canvas match, as the dark variant needs", () => {
    expect(scopeSelector("[data-gf-color-scheme=dark] .x")).toBe(".gf-canvas :is([data-gf-color-scheme=dark] .x)");
  });
});

describe("scopeCss", () => {
  it("scopes every rule in a list", () => {
    expect(scopeCss("h1, .a:hover{color:red}")).toContain(".gf-canvas :is(h1), .gf-canvas :is(.a:hover){color:red}");
  });

  it("turns width media queries into container queries", () => {
    const css = scopeCss("@media (width >= 40rem){.md\\:flex{display:flex}}@media (min-width: 768px){a{b:c}}");
    expect(css).toContain("@container gf-canvas (width >= 40rem){.gf-canvas :is(.md\\:flex){display:flex}}");
    expect(css).toContain("@container gf-canvas (min-width: 768px){");
  });

  it("keeps other media queries", () => {
    const css = scopeCss("@media (prefers-color-scheme: dark){:root{--a:1}}@media print{a{b:c}}");
    expect(css).toContain("@media (prefers-color-scheme: dark){.gf-canvas{--a:1}}");
    expect(css).toContain("@media print{.gf-canvas :is(a){b:c}}");
  });

  it("scopes rules in layers and supports, but not keyframes, font faces or nested rules", () => {
    const css = scopeCss(
      "@layer theme, base;@layer base{*{margin:0}}@supports (display:grid){.g{display:grid}}" +
        "@keyframes spin{to{transform:rotate(1turn)}}@font-face{font-family:x;src:url(x.woff2)}" +
        ".h{&:hover{@media (hover:hover){color:red}}}",
    );
    expect(css).toContain("@layer theme, base;");
    expect(css).toContain("@layer base{.gf-canvas :is(*){margin:0}}");
    expect(css).toContain("@supports (display:grid){.gf-canvas :is(.g){display:grid}}");
    expect(css).toContain("@keyframes spin{to{transform:rotate(1turn)}}");
    expect(css).toContain("@font-face{font-family:x;src:url(x.woff2)}");
    expect(css).toContain(".gf-canvas :is(.h){&:hover{@media (hover:hover){color:red}}}");
  });

  it("isn't confused by braces in strings and comments", () => {
    const css = scopeCss('/* { */ .a::after{content:"}{"} .b{c:d}');
    expect(css).toContain('.gf-canvas :is(.a)::after{content:"}{"}');
    expect(css).toContain(".gf-canvas :is(.b){c:d}");
  });

  it("makes the canvas the container its width queries ask about", () => {
    expect(scopeCss("")).toBe(".gf-canvas{container:gf-canvas/inline-size}\n");
  });
});
