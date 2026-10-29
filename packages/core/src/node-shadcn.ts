/**
 * `goodfellow blocks add <item>`: installs a shadcn registry item with shadcn's
 * own CLI, which can install packages as the admin panel can't, and makes a
 * Goodfellow block of its component, with fields from its props, read with
 * TypeScript's checker. Then it checks what it wrote, and says what it left
 * for the developer to do rather than calling the block finished.
 *
 * TypeScript is loaded only here, from the site's `node_modules`, so sites
 * that never run the command don't download it. With `native`, it also makes
 * the block's version for an Expo app, with shadcn-tamagui-codemod.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type * as Ast from "typescript/unstable/ast";
import type * as Sync from "typescript/unstable/sync";
import {
  type ComponentInfo,
  type ComponentProp,
  componentBlockSource,
  componentDefaults,
  componentNativeBlockSource,
  nativeBlocksIndex,
  propLabel,
} from "./component-blocks.js";
import {
  formatSiteProblem,
  hashText,
  INSTALLED_BLOCKS_DIR,
  INSTALLED_INDEX_FILE,
  INSTALLED_RECORD_FILE,
  installedIndex,
  type PageFile,
  parseInstalledRecord,
  renderedProblems,
  serializeContent,
} from "./index.js";
import { commandToRun } from "./node-command.js";

export type { ComponentInfo, ComponentProp, PropShape } from "./component-blocks.js";
export {
  componentBlockSource,
  componentDefaults,
  componentNativeBlockSource,
  nativeBlocksIndex,
} from "./component-blocks.js";

/** The shadcn CLI the command runs, a release tried with it. */
export const SHADCN_VERSION = "4.21.4";

/** The TypeScript the command reads components with, whose API it was written for. */
export const TYPESCRIPT_VERSION = "7.0.2";

/** The codemod that makes blocks' versions for apps, a release tried with it. */
export const CODEMOD_VERSION = "0.1.0";

/** Where in an Expo app `--native` writes blocks' versions for it, each in a folder of its own, with an index. */
export const NATIVE_BLOCKS_DIR = "goodfellow-blocks";

/** Runs shadcn-tamagui-codemod in the app's folder, with the files it converts and its options. */
export type CodemodRunner = (args: string[], options: { cwd: string }) => Promise<string>;

/** Runs shadcn's CLI in the site: `view` for what an item is, `add` to install it, which may ask the developer. */
export type ShadcnRunner = (args: string[], options: { cwd: string; interactive: boolean }) => Promise<string>;

/**
 * Renders a page of the site with `page` as its content, and the block from its
 * file as well as the config's, giving its HTML, to check the block renders.
 */
export type PageRender = (page: PageFile, block: { name: string; entry: string }) => Promise<string>;

export interface AddShadcnBlockOptions {
  /** The site's folder. */
  root: string;
  /** What `shadcn add` takes: `button`, `@acme/hero`, or an item's address. */
  item: string;
  /** Writes the block into a block registry in this folder, rather than into the site. */
  registry?: string;
  /** Runs shadcn's CLI. Defaults to `npx shadcn@SHADCN_VERSION`. */
  shadcn?: ShadcnRunner;
  /** Renders a page, for the check that the block renders. Without one, it isn't rendered. */
  render?: PageRender;
  /**
   * Also makes the block's version for apps, in this folder: an Expo app's,
   * made with `@goodfellow-cms/expo`, which has Tamagui (see the docs' Apps page).
   */
  native?: string;
  /** Runs shadcn-tamagui-codemod. Defaults to `npx shadcn-tamagui-codemod@CODEMOD_VERSION`. */
  codemod?: CodemodRunner;
}

/** Something the command did, or left for the developer, by kind, in words for the terminal. */
export interface ShadcnNote {
  kind:
    | "packages"
    | "rsc"
    | "skipped"
    | "left-out"
    | "parts"
    | "rule"
    | "hidden"
    | "app"
    | "license"
    | "accessibility"
    | "typecheck"
    | "render"
    | "native";
  text: string;
}

export interface ShadcnBlockResult {
  /** The block's name, its key in content. */
  name: string;
  title: string;
  /** The block's file, from the site's folder or the registry's. */
  entry: string;
  /** Files shadcn and the command wrote, from the site's folder. */
  files: string[];
  /** Packages shadcn added to `package.json`. */
  packages: string[];
  /** The block's fields, by prop name. */
  fields: string[];
  notes: ShadcnNote[];
  /** Where it was written as a registry item, with `registry`. */
  registry?: string;
  /** With `native`, the app's folder, and its version of the block and the files written for it, from that folder. */
  native?: { app: string; entry: string; files: string[] };
}

/** Notes that mean the block doesn't work yet. Others are left to the developer to judge. */
const BLOCKING: ReadonlySet<ShadcnNote["kind"]> = new Set(["typecheck", "render"]);

/** Whether the command left nothing it knows of that stops the block working. */
export function blockWorks(result: ShadcnBlockResult): boolean {
  return !result.notes.some((note) => BLOCKING.has(note.kind));
}

export type ShadcnBlockProblem =
  | { code: "no-components-json" }
  | { code: "typescript"; version?: string }
  | { code: "already-installed"; name: string }
  | { code: "shadcn"; message: string }
  | { code: "no-component"; item: string };

export class ShadcnBlockError extends Error {
  override name = "ShadcnBlockError";

  constructor(readonly problem: ShadcnBlockProblem) {
    super(shadcnProblemText(problem));
  }
}

function shadcnProblemText(problem: ShadcnBlockProblem): string {
  switch (problem.code) {
    case "no-components-json":
      return "This folder has no components.json, which says where shadcn puts components. Run this in a Goodfellow site.";
    case "typescript":
      return [
        `This command reads components' code with TypeScript ${TYPESCRIPT_VERSION}${problem.version ? `, and the site has ${problem.version}` : ", which the site doesn't have"}. Run:`,
        `  npm install --save-dev typescript@${TYPESCRIPT_VERSION}`,
        `or, where the site needs TypeScript 5 for its build, as Next.js sites do:`,
        `  npm install --save-dev typescript-7@npm:typescript@${TYPESCRIPT_VERSION}`,
      ].join("\n");
    case "already-installed":
      return `The site already has a block called ${problem.name}. Remove it on the Blocks screen first, or add it under another name.`;
    case "shadcn":
      return `shadcn's CLI didn't finish: ${problem.message}`;
    case "no-component":
      return `${problem.item} has no React component to make a block of.`;
  }
}

const execFileAsync = promisify(execFile);

/** shadcn's CLI from npm, at the release the command was tried with. */
export const npxShadcn: ShadcnRunner = async (args, { cwd, interactive }) => {
  const run = commandToRun("npx", ["--yes", `shadcn@${SHADCN_VERSION}`, ...args]);
  if (!interactive) {
    const { stdout } = await execFileAsync(run.file, run.args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      shell: run.shell,
    });
    return stdout;
  }
  // `add` asks before replacing a file that differs, even with --yes, so the developer answers.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(run.file, run.args, { cwd, stdio: "inherit", shell: run.shell });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exited with code ${code}`))));
  });
  return "";
};

/** shadcn-tamagui-codemod from npm, at the release the command was tried with. */
export const npxCodemod: CodemodRunner = async (args, { cwd }) => {
  const run = commandToRun("npx", ["--yes", `shadcn-tamagui-codemod@${CODEMOD_VERSION}`, ...args]);
  const { stdout } = await execFileAsync(run.file, run.args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    shell: run.shell,
  });
  return stdout;
};

/** The parts of a registry item the command reads. */
interface ViewedItem {
  name: string;
  title?: string;
  type: string;
  categories?: string[];
  files?: Array<{ path: string; type: string; target?: string }>;
  dependencies?: string[];
  registryDependencies?: string[];
  meta?: { license?: unknown };
}

const OWN_FILE_TYPES = new Set(["registry:ui", "registry:component", "registry:block"]);
const SHARED_FILE_TYPES = new Set([
  "registry:lib",
  "registry:hook",
  "registry:file",
  "registry:style",
  "registry:theme",
]);

/** Folders shadcn writes into in a Goodfellow site, and the command too. */
const WATCHED = ["components", "lib", "hooks", INSTALLED_BLOCKS_DIR];

async function listFiles(root: string, dir: string, out: Map<string, string>): Promise<Map<string, string>> {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const entry of await readdir(full, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await listFiles(root, path, out);
    else out.set(path, await readFile(join(root, path), "utf8"));
  }
  return out;
}

async function watchedFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const dir of WATCHED) await listFiles(root, dir, files);
  return files;
}

async function dependencies(root: string): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return pkg.dependencies ?? {};
}

/**
 * shadcn drops `"use client"` from what it installs where `components.json`
 * says `"rsc": false`, and Goodfellow runs Client Components in the browser
 * only where they say it, so the command makes sure it's `true`.
 */
async function keepClientDirectives(root: string, notes: ShadcnNote[]): Promise<void> {
  const file = join(root, "components.json");
  const text = await readFile(file, "utf8");
  if (!/"rsc"\s*:\s*false/.test(text)) return;
  await writeFile(file, text.replace(/"rsc"(\s*):(\s*)false/, '"rsc"$1:$2true'));
  notes.push({
    kind: "rsc",
    text: 'components.json now says "rsc": true, so shadcn keeps components\' "use client", which Goodfellow needs to run them in the browser.',
  });
}

/**
 * The package names TypeScript 7 may be installed under: its own, or an alias
 * for sites whose `typescript` stays at 5, as the Next.js starter's does for
 * `next build` (`npm install --save-dev typescript-7@npm:typescript@7.0.2`).
 */
export const TYPESCRIPT_PACKAGES = ["typescript", "typescript-7"] as const;

/** TypeScript 7's API from the site's packages, under either name, whose checker reads components. */
async function loadTypeScript(root: string): Promise<{ sync: typeof Sync; ast: typeof Ast }> {
  const require = createRequire(join(root, "package.json"));
  let found: string | undefined;
  for (const name of TYPESCRIPT_PACKAGES) {
    try {
      found ??= (JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8")) as { version: string })
        .version;
      const load = (path: string) => import(pathToFileURL(require.resolve(`${name}/${path}`)).href);
      const [sync, ast] = (await Promise.all([load("unstable/sync"), load("unstable/ast")])) as [
        typeof Sync,
        typeof Ast,
      ];
      return { sync, ast };
    } catch {
      // Not installed, or a TypeScript without the API: try the next name.
    }
  }
  throw new ShadcnBlockError({ code: "typescript", ...(found && { version: found }) });
}

/** `button` → `Button`, `login-01` → `Login01`. */
function pascal(name: string): string {
  return name.replace(/(^|[-_])([a-z0-9])/g, (_, __, letter: string) => letter.toUpperCase());
}

/** A component the item exports. */
interface FoundComponent {
  name: string;
  isDefault: boolean;
  file: string;
  sourceFile: Ast.SourceFile;
  props: readonly Sync.Symbol[];
}

/** Whether a symbol is declared only in packages, as the HTML attributes components pass on are. */
function fromPackages(symbol: Sync.Symbol): boolean {
  return (
    symbol.declarations.length > 0 && symbol.declarations.every((d) => /[\\/]node_modules[\\/]/.test(String(d.path)))
  );
}

/** Where words are a component's children: buttons, links and labels, by the attributes React's types give them. */
const TEXT_ELEMENTS = new Set(["ButtonHTMLAttributes", "AnchorHTMLAttributes", "LabelHTMLAttributes"]);

/** Reads components with one TypeScript project of the site, made again after files change. */
class ComponentReader {
  private api: Sync.API;
  private project!: Sync.Project;
  private readonly configFile: string;

  constructor(
    private readonly ts: { sync: typeof Sync; ast: typeof Ast },
    private readonly root: string,
  ) {
    this.configFile = this.path("tsconfig.json");
    this.api = this.start();
  }

  /** TypeScript's server, with the site's project as the disk has it now. */
  private start(): Sync.API {
    const api = new this.ts.sync.API({ cwd: this.root });
    const snapshot = api.updateSnapshot({ openProjects: [this.configFile] });
    const project = snapshot.getProject(this.configFile) ?? snapshot.getProjects()[0];
    if (!project) {
      api.close();
      throw new ShadcnBlockError({ code: "typescript" });
    }
    this.project = project;
    return api;
  }

  /**
   * Reads the site again once files are written, with a new server: one told
   * which files were made didn't take them in on Windows, and one told to read
   * everything again only reads the files it had.
   */
  refresh(): void {
    this.api.close();
    this.api = this.start();
  }

  close(): void {
    this.api.close();
  }

  /** A file in the site by its full path, with forward slashes, as TypeScript names files on Windows too. */
  private path(file: string): string {
    return join(this.root, file).replaceAll("\\", "/");
  }

  sourceFile(file: string): Ast.SourceFile | undefined {
    return this.project.program.getSourceFile(this.path(file));
  }

  /** The PascalCase functions a file exports, with their first parameter's properties. */
  components(file: string): FoundComponent[] {
    const { checker } = this.project;
    const { SymbolFlags, SignatureKind } = this.ts.sync;
    const sourceFile = this.sourceFile(file);
    if (!sourceFile) return [];
    const module = checker.getSymbolAtLocation(sourceFile);
    if (!module) return [];
    const found: FoundComponent[] = [];
    for (const exported of checker.getExportsOfModule(module)) {
      const isDefault = exported.name === "default";
      const symbol = exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = symbol.valueDeclaration?.resolve(this.project) as { name?: { text?: string } } | undefined;
      const name = isDefault
        ? (declaration?.name?.text ?? pascal(basename(file).replace(/\.[jt]sx?$/, "")))
        : symbol.name;
      if (!/^[A-Z]/.test(name)) continue;
      const type = checker.getTypeOfSymbol(symbol);
      const [signature] = type ? checker.getSignaturesOfType(type, SignatureKind.Call) : [];
      if (!signature) continue;
      const props = checker.getParameterType(signature, 0);
      found.push({ name, isDefault, file, sourceFile, props: props ? checker.getPropertiesOfType(props) : [] });
    }
    return found;
  }

  /** The interfaces in packages that a component's props come from, such as `ButtonHTMLAttributes`. */
  inheritedFrom(props: readonly Sync.Symbol[]): Set<string> {
    const names = new Set<string>();
    for (const prop of props) {
      if (!fromPackages(prop)) continue;
      for (const declaration of prop.declarations) {
        const owner = declaration.resolve(this.project)?.parent;
        if (owner && this.ts.ast.isInterfaceDeclaration(owner)) names.add(owner.name.text);
      }
    }
    return names;
  }

  /** What a prop holds, as a block's field can show it, or a note on why it can't. */
  shape(
    name: string,
    type: Sync.Type,
    path: string,
    notes: ShadcnNote[],
    depth = 0,
  ): ComponentProp["shape"] | undefined {
    const { checker } = this.project;
    const { TypeFlags, SignatureKind } = this.ts.sync;
    const own = type.isUnionType()
      ? type.getTypes().filter((part) => !(part.flags & (TypeFlags.Undefined | TypeFlags.Null)))
      : [type];
    const literals = own.filter((part) => part.flags & TypeFlags.StringLiteral) as Sync.StringLiteralType[];
    if (own.length > 1 && literals.length === own.length)
      return { kind: "choice", values: literals.map((part) => part.value) };
    if (own.length > 0 && own.every((part) => part.flags & (TypeFlags.Boolean | TypeFlags.BooleanLiteral))) {
      return { kind: "boolean" };
    }
    const [one] = own;
    if (one && own.length === 1) {
      if (one.flags & (TypeFlags.String | TypeFlags.StringLiteral)) {
        // A picture's address, by its name, gets the media library's chooser.
        return {
          kind: "text",
          ...(/^(src|srcDark|image|img|imageUrl|avatar|logo|photo|picture)$/i.test(name) && { media: true }),
        };
      }
      if (one.flags & TypeFlags.Number) return { kind: "number" };
      if (depth < 3 && one.isObjectType() && checker.getSignaturesOfType(one, SignatureKind.Call).length === 0) {
        const element = checker.isArrayType(one) ? checker.getTypeArguments(one as Sync.TypeReference)[0] : undefined;
        const props = this.objectProps(element ?? one, element ? `${path}[]` : path, notes, depth + 1);
        if (props.length > 0) return { kind: element ? "list" : "object", props };
      }
    }
    notes.push({
      kind: "left-out",
      text: `${path} is ${checker.typeToString(type)}, which no field holds: words, numbers, choices, yes or no, and lists and groups of them do.`,
    });
    return undefined;
  }

  private objectProps(type: Sync.Type, path: string, notes: ShadcnNote[], depth: number): ComponentProp[] {
    const props: ComponentProp[] = [];
    for (const symbol of this.project.checker.getPropertiesOfType(type)) {
      const propType = this.project.checker.getTypeOfSymbol(symbol);
      const shape = propType && this.shape(symbol.name, propType, `${path}.${symbol.name}`, notes, depth);
      if (shape) props.push({ name: symbol.name, shape });
    }
    return props;
  }

  typeOf(symbol: Sync.Symbol): Sync.Type | undefined {
    return this.project.checker.getTypeOfSymbol(symbol);
  }

  /** What TypeScript finds wrong with a file, in its own words. */
  problems(file: string): string[] {
    const diagnostics = this.project.program.getSemanticDiagnostics(this.path(file));
    return diagnostics.map((diagnostic) => diagnosticText(diagnostic));
  }
}

function diagnosticText(diagnostic: Sync.Diagnostic): string {
  const message =
    (diagnostic as { text?: unknown; messageText?: unknown }).text ??
    (diagnostic as { messageText?: unknown }).messageText;
  if (typeof message === "string") return message;
  return JSON.stringify(message);
}

/** A literal value in code, such as a default, or `undefined` for anything else. */
function literal(ast: typeof Ast, node: Ast.Node | undefined): unknown {
  if (!node) return undefined;
  if (ast.isStringLiteral(node) || ast.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ast.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ast.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ast.SyntaxKind.FalseKeyword) return false;
  if (ast.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ast.isPropertyAssignment(property)) continue;
      const key = (property.name as { text?: string }).text;
      const inner = literal(ast, property.initializer);
      if (key !== undefined && inner !== undefined) value[key] = inner;
    }
    return value;
  }
  if (ast.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literal(ast, element)).filter((value) => value !== undefined);
  }
  return undefined;
}

/**
 * The defaults a component's code gives its props: a `defaultProps` object, as
 * shadcnblocks' sections have, defaults in its parameter's destructuring, and
 * cva's `defaultVariants`.
 */
function codeDefaults(ast: typeof Ast, sourceFile: Ast.SourceFile): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const visit = (node: Ast.Node): void => {
    if (ast.isVariableDeclaration(node) && ast.isIdentifier(node.name) && node.name.text === "defaultProps") {
      Object.assign(defaults, literal(ast, node.initializer));
    }
    if (ast.isPropertyAssignment(node) && (node.name as { text?: string }).text === "defaultVariants") {
      Object.assign(defaults, literal(ast, node.initializer));
    }
    if (ast.isBindingElement(node) && node.initializer && node.name && ast.isIdentifier(node.name)) {
      const value = literal(ast, node.initializer);
      if (value !== undefined && !(node.name.text in defaults)) defaults[node.name.text] = value;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return defaults;
}

/** Whether a component shows its children: it names them, or passes its props on to an element with none of its own. */
function rendersChildren(ast: typeof Ast, sourceFile: Ast.SourceFile, component: string): boolean {
  let found = false;
  const visit = (node: Ast.Node, inside: boolean): void => {
    if (found) return;
    const named =
      (ast.isFunctionDeclaration(node) || ast.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ast.isIdentifier(node.name) &&
      node.name.text === component;
    const within = inside || named;
    if (within && ast.isIdentifier(node) && node.text === "children") found = true;
    if (
      within &&
      ast.isJsxSelfClosingElement(node) &&
      node.attributes.properties.some((a) => ast.isJsxSpreadAttribute(a))
    ) {
      found = true;
    }
    node.forEachChild((child) => visit(child, within));
  };
  visit(sourceFile, false);
  return found;
}

/** Parts whose content is the page's words, hidden until opened: overlays such as dialogs and menus aren't. */
const DISCLOSED =
  /^(Accordion|Collapsible|Tabs)(Primitive\.)?Content$|^(AccordionPrimitive|CollapsiblePrimitive|TabsPrimitive)\.Content$/;

/** What a block must do that the item's code doesn't, and what it is: Goodfellow's rules for blocks, read from code. */
function codeNotes(ast: typeof Ast, file: string, sourceFile: Ast.SourceFile): ShadcnNote[] {
  const notes: ShadcnNote[] = [];
  const client = /^\s*["']use client["']/.test(sourceFile.text);
  const visit = (node: Ast.Node): void => {
    if (ast.isJsxOpeningElement(node) || ast.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      const text = node.getText(sourceFile);
      if (tag === "a") {
        notes.push({
          kind: "rule",
          text: `${file} uses <a>, whose links don't follow the site's base path: use SiteLink.`,
        });
      }
      if (tag === "img") {
        notes.push({
          kind: "rule",
          text: `${file} uses <img>, whose pictures don't follow the site's base path: use SiteImage.`,
        });
      }
      if (tag === "form" || (tag === "input" && /type=["']password["']/.test(text))) {
        notes.push({ kind: "app", text: `${file} has a <${tag}>, and a static site has nothing to send it to.` });
      }
      // Radix leaves a closed accordion's, collapsible's or tab's content out of the page unless it's forced to stay, hidden.
      if (DISCLOSED.test(tag) && !file.startsWith("components/ui/") && !/forceMount/.test(text)) {
        notes.push({
          kind: "hidden",
          text: `${file}'s <${tag}> leaves what's closed out of the page, so search engines don't see it: forceMount keeps it in, hidden with CSS, as shadcn-faq does.`,
        });
      }
    }
    if (ast.isImportDeclaration(node) && ast.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (from === "next/link" || from === "next/image") {
        notes.push({
          kind: "rule",
          text: `${file} imports ${from}, which sites built with goodfellow build don't have: use SiteLink or SiteImage.`,
        });
      }
    }
    if (!client && ast.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/^(React\.)?use[A-Z]/.test(callee)) {
        notes.push({
          kind: "rule",
          text: `${file} calls ${callee} without "use client", which fails where pages render on the server.`,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return notes;
}

/** Notes without repeats, in the order they came. */
function unique(notes: ShadcnNote[]): ShadcnNote[] {
  const seen = new Set<string>();
  return notes.filter((note) => !seen.has(note.text) && Boolean(seen.add(note.text)));
}

/** Where the command writes the block: its folder, and its file, from the site's folder. */
function blockEntry(name: string): string {
  return `${INSTALLED_BLOCKS_DIR}/${name}/block.tsx`;
}

/** A page with the block on it, with its defaults, to render. */
function blockPage(name: string, props: Record<string, unknown>): PageFile {
  return {
    version: 1,
    data: {
      root: { props: { title: "Block check" } },
      content: [{ type: name, props: { id: `${name}-check`, ...props } }],
    },
  } as PageFile;
}

/**
 * Installs a shadcn item and makes a block of its component, recorded in
 * `blocks/installed/` as the Blocks screen's are, so it lists the block and can
 * remove it. With `registry`, the block goes into a block registry instead.
 */
export async function addShadcnBlock(options: AddShadcnBlockOptions): Promise<ShadcnBlockResult> {
  const { root, item: ref } = options;
  const shadcn = options.shadcn ?? npxShadcn;
  const notes: ShadcnNote[] = [];
  // Nothing in the site changes until the command knows it can go ahead.
  if (!existsSync(join(root, "components.json"))) throw new ShadcnBlockError({ code: "no-components-json" });
  const ts = await loadTypeScript(root);

  let viewed: ViewedItem;
  try {
    const [first] = JSON.parse(await shadcn(["view", ref], { cwd: root, interactive: false })) as ViewedItem[];
    if (!first) throw new Error(`nothing is called ${ref}`);
    viewed = first;
  } catch (error) {
    throw error instanceof ShadcnBlockError
      ? error
      : new ShadcnBlockError({ code: "shadcn", message: (error as Error).message });
  }
  const name = viewed.name;
  const record = parseInstalledRecord(await readFile(join(root, INSTALLED_RECORD_FILE), "utf8").catch(() => undefined));
  if (record.blocks[name] || existsSync(join(root, INSTALLED_BLOCKS_DIR, name))) {
    throw new ShadcnBlockError({ code: "already-installed", name });
  }
  await keepClientDirectives(root, notes);

  // Install it, noting what shadcn writes and adds.
  const before = await watchedFiles(root);
  const packagesBefore = await dependencies(root);
  const add = async (target: string) => {
    try {
      await shadcn(["add", target, "--yes"], { cwd: root, interactive: true });
    } catch (error) {
      throw new ShadcnBlockError({ code: "shadcn", message: (error as Error).message });
    }
  };
  await add(ref);
  const after = await watchedFiles(root);
  const packages = Object.keys(await dependencies(root)).filter((pkg) => !(pkg in packagesBefore));
  if (packages.length > 0) {
    notes.push({
      kind: "packages",
      text: `shadcn added ${packages.join(", ")} to package.json. Commit package-lock.json with them.`,
    });
  }
  for (const file of viewed.files ?? []) {
    if (!OWN_FILE_TYPES.has(file.type) && !SHARED_FILE_TYPES.has(file.type)) {
      notes.push({
        kind: "skipped",
        text: `${file.path} (${file.type}) isn't part of the block, since a block is only part of a page.`,
      });
    }
  }
  // The item's own files, where shadcn put them: by name, since it leaves out their folders.
  const ownFiles = (viewed.files ?? [])
    .filter((file) => OWN_FILE_TYPES.has(file.type))
    .map((file) => [...after.keys()].find((path) => basename(path) === basename(file.target ?? file.path)))
    .filter((path): path is string => path !== undefined);

  const reader = new ComponentReader(ts, root);
  try {
    let components = ownFiles.flatMap((file) => reader.components(file));
    let section = viewed.type === "registry:block";
    let ownCode = [...ownFiles];

    // Parts that only work together, such as an accordion's, share React context, and islands don't, so the block
    // shows shadcn's example of them, as one Client Component in its own folder.
    const [first] = components;
    const partsOf = components.filter(
      (c) => c !== first && first && c.file === first.file && c.name.startsWith(first.name),
    );
    if (first && partsOf.length > 0) {
      const list = `${first.name} works with ${partsOf.map((part) => part.name).join(", ")}, which share its React context`;
      try {
        await add(`${ref}-demo`);
        const example = `components/${name}-demo.tsx`;
        const code = await readFile(join(root, example), "utf8");
        const file = `${INSTALLED_BLOCKS_DIR}/${name}/${name}-parts.tsx`;
        await mkdir(join(root, dirname(file)), { recursive: true });
        await writeFile(join(root, file), `"use client";\n\n${code.replace(/^\s*["']use client["'];?\s*/, "")}`);
        await rm(join(root, example), { force: true });
        reader.refresh();
        components = reader.components(file);
        ownCode = [...ownCode, file];
        section = false;
        notes.push({
          kind: "parts",
          text: `${list}, so the block shows shadcn's example of them (${ref}-demo), in ${file}, whose words are in its code: make fields of them by hand, as shadcn-faq does.`,
        });
      } catch {
        notes.push({
          kind: "parts",
          text: `${list}, and shadcn has no example of them: write a block of them together by hand, as shadcn-faq was.`,
        });
      }
    }

    const main =
      components.find((c) => c.name === pascal(name)) ??
      (new Set(components.map((c) => c.file)).size === 1 ? components[0] : undefined) ??
      components.find((c) => !c.file.startsWith("components/ui/"));
    if (!main) throw new ShadcnBlockError({ code: "no-component", item: ref });

    // Fields from its own props, leaving out the HTML attributes it passes on and what editors don't choose.
    const defaults = codeDefaults(ts.ast, main.sourceFile);
    const props: ComponentProp[] = [];
    let children: ComponentInfo["children"];
    let className = false;
    for (const prop of main.props) {
      if (prop.name === "className") {
        className = true;
        continue;
      }
      if (prop.name === "children") {
        if (rendersChildren(ts.ast, main.sourceFile, main.name)) {
          const inherited = reader.inheritedFrom(main.props);
          children = [...inherited].some((name) => TEXT_ELEMENTS.has(name)) ? "text" : "slot";
        }
        continue;
      }
      if (fromPackages(prop) || prop.name === "asChild") continue;
      if (/^on[A-Z]/.test(prop.name)) {
        // What happens on a click isn't something editors choose, but a component that needs it doesn't work without it.
        if (!(prop.flags & ts.sync.SymbolFlags.Optional)) {
          notes.push({
            kind: "left-out",
            text: `${prop.name} is what ${main.name} does when something happens, which no field can say.`,
          });
        }
        continue;
      }
      const type = reader.typeOf(prop);
      const shape = type && reader.shape(prop.name, type, prop.name, notes);
      if (shape) props.push({ name: prop.name, shape, ...(prop.name in defaults && { default: defaults[prop.name] }) });
    }

    for (const file of ownCode) {
      const sourceFile = reader.sourceFile(file);
      if (sourceFile) notes.push(...codeNotes(ts.ast, file, sourceFile));
    }
    if (
      (viewed.categories ?? []).some((category) =>
        ["authentication", "login", "dashboard", "sidebar"].includes(category),
      )
    ) {
      notes.push({
        kind: "app",
        text: `${name} is app UI (${viewed.categories?.join(", ")}), and a static site has nothing behind it.`,
      });
    }
    if (typeof viewed.meta?.license === "string") {
      notes.push({ kind: "license", text: `${name} comes with its own license: ${viewed.meta.license}` });
    }

    const title = viewed.title?.replace(/\s+-\s+.*$/, "") || propLabel(name);
    const from = `@/${main.file.replace(/\.[jt]sx?$/, "")}`;
    const info: ComponentInfo = {
      name,
      title,
      component: main.name,
      from,
      isDefault: main.isDefault,
      props,
      ...(children && { children }),
      className,
      section,
    };
    const entry = blockEntry(name);
    const write = async (notesForFile: ShadcnNote[]) => {
      const source = componentBlockSource({ ...info, notes: unique(notesForFile).map((note) => note.text) });
      await mkdir(join(root, dirname(entry)), { recursive: true });
      await writeFile(join(root, entry), source);
    };
    await write(notes);

    // It must typecheck and render before it's any use.
    reader.refresh();
    for (const problem of reader.problems(entry)) notes.push({ kind: "typecheck", text: `${entry}: ${problem}` });
    if (options.render) {
      try {
        const html = await options.render(blockPage(name, componentDefaults(info)), { name, entry });
        // Only what the block brings: the header's and footer's are the site's own.
        const file = "content/pages/index.json";
        for (const problem of renderedProblems({ html, path: "/", file })) {
          if (problem.file !== file) continue;
          // Said of the block, not of the page it was rendered on.
          const said = formatSiteProblem(problem).replace(/^\S+ \(\/\) /, "");
          notes.push({ kind: "accessibility", text: `With its defaults, the block ${said}` });
        }
      } catch (error) {
        notes.push({ kind: "render", text: `It doesn't render with its defaults: ${(error as Error).message}` });
      }
    }
    const final = unique(notes);
    await write(final.filter((note) => !BLOCKING.has(note.kind)));

    const written = [...(await watchedFiles(root))]
      .filter(([path, text]) => before.get(path) !== text)
      .map(([path]) => path);
    const result: ShadcnBlockResult = {
      name,
      title,
      entry,
      files: written.sort(),
      packages,
      fields: [...props.map((prop) => prop.name), ...(children ? ["children"] : [])],
      notes: final,
    };
    if (options.native) {
      const native = await writeNativeBlock({
        root,
        app: options.native,
        info,
        main: main.file,
        ownCode,
        codemod: options.codemod ?? npxCodemod,
      });
      result.notes.push(...native.notes);
      if (native.written) result.native = native.written;
    }
    if (options.registry) {
      return {
        ...result,
        registry: await writeRegistryItem(root, options.registry, viewed, ref, info, ownCode, entry),
      };
    }

    // Recorded as the Blocks screen's are: its files and what shadcn wrote for it, with hashes of what was written.
    const files: Record<string, string> = {};
    for (const path of written) files[path] = await hashText(await readFile(join(root, path), "utf8"));
    record.blocks[name] = { source: ref, title, category: section ? "Page sections" : "Components", entry, files };
    await writeFile(join(root, INSTALLED_RECORD_FILE), serializeContent(record));
    await writeFile(join(root, INSTALLED_INDEX_FILE), installedIndex(record));
    return result;
  } finally {
    reader.close();
  }
}

/** The site's own modules a file imports through `@/`, such as `@/components/ui/button`. */
function siteImports(code: string): string[] {
  return [...code.matchAll(/from\s+["']@\/([^"']+)["']/g)].map((match) => match[1] ?? "").filter(Boolean);
}

/** A module's file in a folder, by its import path without an extension. */
function moduleFile(dir: string, path: string): string | undefined {
  return [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"]
    .map((ending) => `${path}${ending}`)
    .find((candidate) => existsSync(join(dir, candidate)));
}

/** What shadcn-tamagui-codemod's report says, as far as the command tells the developer. */
interface CodemodReport {
  totals?: { diagnostics?: Partial<Record<"todo" | "warning" | "info", number>> };
  icons?: { command?: string | null };
}

/**
 * Makes the block's version for an Expo app in `app`: copies the item's own
 * code into `goodfellow-blocks/<name>/`, and the site's components it uses
 * that the app doesn't have yet into the app at the same paths, converts
 * them with shadcn-tamagui-codemod, writes the block, which takes the site's
 * block's props, and the index of the app's blocks. It changes nothing in
 * the site, and never stops the site's block being made: problems are notes.
 */
async function writeNativeBlock(options: {
  root: string;
  app: string;
  info: ComponentInfo;
  main: string;
  ownCode: string[];
  codemod: CodemodRunner;
}): Promise<{ notes: ShadcnNote[]; written?: ShadcnBlockResult["native"] }> {
  const { root, app, info, main, ownCode } = options;
  const notes: ShadcnNote[] = [];
  const folder = `${NATIVE_BLOCKS_DIR}/${info.name}`;
  const entry = `${folder}/block.tsx`;
  if (existsSync(join(app, entry))) {
    return {
      notes: [{ kind: "native", text: `The app already has ${entry}, so its version wasn't made again.` }],
    };
  }
  // The item's own code goes in the block's folder; what it imports from the site goes where the app imports it from.
  const copies = new Map<string, string>();
  for (const file of ownCode) copies.set(file, `${folder}/${basename(file)}`);
  const pending = [...ownCode];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    for (const path of siteImports(await readFile(join(root, file), "utf8"))) {
      const found = moduleFile(root, path);
      if (!found || copies.has(found) || moduleFile(app, path)) continue;
      copies.set(found, found);
      pending.push(found);
    }
  }
  for (const [from, to] of copies) {
    await mkdir(dirname(join(app, to)), { recursive: true });
    await writeFile(join(app, to), await readFile(join(root, from), "utf8"));
  }

  const reports = await mkdtemp(join(tmpdir(), "goodfellow-codemod-"));
  try {
    const report = join(reports, "report");
    try {
      await options.codemod([...copies.values(), "--write", "--report", report], { cwd: app });
    } catch (error) {
      notes.push({
        kind: "native",
        text: `shadcn-tamagui-codemod didn't finish, so ${folder} has the site's code as it is: ${(error as Error).message}`,
      });
    }
    const said = JSON.parse(await readFile(`${report}.json`, "utf8").catch(() => "{}")) as CodemodReport;
    const todos = said.totals?.diagnostics?.todo ?? 0;
    if (todos > 0) {
      notes.push({
        kind: "native",
        text: `The codemod couldn't convert ${todos} ${todos === 1 ? "part" : "parts"} of the app's version: look for // TODO(native) in ${[...copies.values()].join(", ")}.`,
      });
    }
    if (said.icons?.command) {
      notes.push({ kind: "native", text: `The app's version needs its icons made, in the app: ${said.icons.command}` });
    }
  } finally {
    await rm(reports, { recursive: true, force: true });
  }

  // The component, from its copy in the block's folder, or from where the app has the site's component.
  const own = copies.get(main);
  const from = own?.startsWith(`${folder}/`)
    ? `./${basename(own).replace(/\.[jt]sx?$/, "")}`
    : `@/${main.replace(/\.[jt]sx?$/, "")}`;
  await writeFile(join(app, entry), componentNativeBlockSource(info, from));
  const names = (await readdir(join(app, NATIVE_BLOCKS_DIR), { withFileTypes: true }))
    .filter((item) => item.isDirectory() && existsSync(join(app, NATIVE_BLOCKS_DIR, item.name, "block.tsx")))
    .map((item) => item.name);
  await writeFile(join(app, NATIVE_BLOCKS_DIR, "index.ts"), nativeBlocksIndex(names));
  notes.push({
    kind: "native",
    text: `The app needs Tamagui for its version (withTamagui in metro.config.js, TamaguiProvider around the app), and installedNativeBlocks from ${NATIVE_BLOCKS_DIR}/index.ts given to <GoodfellowSite> beside nativeBlocks.`,
  });
  return {
    notes,
    written: { app, entry, files: [...new Set([entry, `${NATIVE_BLOCKS_DIR}/index.ts`, ...copies.values()])].sort() },
  };
}

/** A registry's `registry.json`, as far as the command changes it. */
interface RegistryIndex {
  $schema?: string;
  name: string;
  homepage?: string;
  items: Array<{ name: string } & Record<string, unknown>>;
}

/**
 * Writes the block as an item of a block registry in `dir`: its file and the
 * item's own code, with the item's shadcn dependencies, so every site's Blocks
 * screen can install it, and takes it back out of the site.
 */
async function writeRegistryItem(
  root: string,
  dir: string,
  viewed: ViewedItem,
  ref: string,
  info: ComponentInfo,
  ownCode: string[],
  entry: string,
): Promise<string> {
  const indexFile = join(dir, "registry.json");
  const index: RegistryIndex = existsSync(indexFile)
    ? (JSON.parse(await readFile(indexFile, "utf8")) as RegistryIndex)
    : { $schema: "https://ui.shadcn.com/schema/registry.json", name: basename(dir), items: [] };
  const files = [
    { path: `blocks/${info.name}/block.tsx`, type: "registry:block" },
    ...ownCode.map((file) => ({ path: file, type: "registry:component", target: `~/${file}` })),
  ];
  for (const [file, from] of [
    [`blocks/${info.name}/block.tsx`, entry],
    ...ownCode.map((file) => [file, file]),
  ] as const) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), await readFile(join(root, from), "utf8"));
  }
  const item = {
    name: info.name,
    type: "registry:block",
    title: info.title,
    description: `${info.title}, made from ${ref} by goodfellow blocks add.`,
    registryDependencies: viewed.registryDependencies ?? [],
    dependencies: viewed.dependencies ?? [],
    files,
    meta: { goodfellow: { category: info.section ? "Page sections" : "Components" } },
  };
  index.items = [...index.items.filter((existing) => existing.name !== info.name), item];
  await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  // The site keeps what shadcn installed, but not the block, which sites get from the registry.
  await rm(join(root, INSTALLED_BLOCKS_DIR, info.name), { recursive: true, force: true });
  return relative(root, indexFile) || indexFile;
}

/** Notes on what the command did, rather than on what's left. */
const DONE: ReadonlySet<ShadcnNote["kind"]> = new Set(["packages", "rsc", "skipped"]);

/** The command's report, for the terminal. */
export function formatShadcnBlock(result: ShadcnBlockResult): string {
  const lines = [
    result.registry
      ? `Wrote the block ${result.name} into ${result.registry}.`
      : `Made the block ${result.name} (${result.title}) in ${result.entry}. Restart goodfellow dev to see it.`,
    result.fields.length > 0 ? `Its fields: ${result.fields.join(", ")}.` : "It has no fields.",
    ...(result.native
      ? [`Made its version for apps in ${join(result.native.app, result.native.entry)}, with shadcn-tamagui-codemod.`]
      : []),
    ...result.notes.filter((note) => DONE.has(note.kind)).map((note) => note.text),
  ];
  const list = (title: string, notes: ShadcnNote[]) => {
    if (notes.length > 0) lines.push(title, ...notes.map((note) => `  - ${note.text}`));
  };
  list(
    "It doesn't work yet:",
    result.notes.filter((note) => BLOCKING.has(note.kind)),
  );
  list(
    "Left to do by hand:",
    result.notes.filter((note) => !BLOCKING.has(note.kind) && !DONE.has(note.kind)),
  );
  return lines.join("\n");
}
