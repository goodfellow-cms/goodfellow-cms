/**
 * Whether an SVG is already as the admin panel's `cleanSvg()` leaves one,
 * checked without a DOM, for what's sent to a server rather than uploaded
 * through the admin panel: a server can't trust that the browser cleaned it.
 * Strict where the browser's parser and htmlparser2 could read a file
 * differently: anything a cleaned file never has (a doctype and the entities it
 * could declare, comments, processing instructions other than the XML
 * declaration, prefixed elements, other namespaces) makes it unclean.
 */
import type { AnyNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import { extensionOf, fileName, mediaKind } from "./content/media-files.js";
import { MEDIA_DIR } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
import {
  cleanedSvgAttribute,
  cssWithoutOutsideAddresses,
  keepsSvgElement,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
} from "./svg-rules.js";

/** Each prefix an element's attributes may use, and the namespace it must name. */
const PREFIXES: Record<string, string> = { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE, xlink: XLINK_NAMESPACE };

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/** Whether an element, and everything in it, is as cleaning leaves it, with `xlink` declared where it's in scope. */
function cleanElement(element: Element, xlink: boolean): boolean {
  if (element.name.includes(":")) return false;
  const declared = element.attribs.xmlns;
  if (declared !== undefined && declared !== SVG_NAMESPACE) return false;
  if (!keepsSvgElement(element.name, element.attribs.attributeName ?? null)) return false;
  let inScope = xlink;
  for (const [name, value] of Object.entries(element.attribs)) {
    if (name.startsWith("xmlns:")) {
      // Only the xlink prefix may be declared, and only as xlink.
      if (name !== "xmlns:xlink" || value !== XLINK_NAMESPACE) return false;
      inScope = true;
    }
  }
  for (const [name, value] of Object.entries(element.attribs)) {
    const colon = name.indexOf(":");
    const prefix = colon === -1 ? undefined : name.slice(0, colon);
    const localName = colon === -1 ? name : name.slice(colon + 1);
    if (prefix === "xlink" && !inScope) return false;
    const namespace = name === "xmlns" ? XMLNS_NAMESPACE : prefix === undefined ? null : PREFIXES[prefix];
    if (namespace === undefined) return false;
    const cleaned = cleanedSvgAttribute(element.name, name, localName, namespace, value);
    if (!cleaned.keep || cleaned.value !== value) return false;
  }
  for (const child of element.children) {
    if (isElement(child)) {
      if (!cleanElement(child, inScope)) return false;
    } else if (child.type === "cdata") {
      if (element.name !== "style") return false;
    } else if (child.type !== "text") {
      return false;
    }
  }
  if (element.name === "style") {
    const css = element.children
      .map((child) => (child.type === "text" ? child.data : child.type === "cdata" ? textOf(child) : ""))
      .join("");
    if (cssWithoutOutsideAddresses(css) !== css) return false;
  }
  return true;
}

function textOf(node: AnyNode): string {
  if (node.type === "text") return node.data;
  return "children" in node ? (node.children as AnyNode[]).map(textOf).join("") : "";
}

/**
 * Whether an SVG keeps only what draws it, as `cleanSvg()` would leave it:
 * one `svg` root in SVG's namespace, and nothing outside it but the XML
 * declaration and spaces.
 */
export function isCleanSvg(text: string): boolean {
  // A doctype could declare entities, which only the browser's parser would expand.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return false;
  const doc = parseDocument(text, { xmlMode: true, decodeEntities: true });
  const roots = doc.children.filter((node) => {
    if (node.type === "text") return node.data.trim() !== "";
    return !(node.type === "directive" && node.name === "?xml" && doc.children.indexOf(node) === 0);
  });
  const [root] = roots;
  if (roots.length !== 1 || !root || !isElement(root) || root.name !== "svg") return false;
  if (root.attribs.xmlns !== SVG_NAMESPACE) return false;
  return cleanElement(root, false);
}

/**
 * The paths of changes a server must refuse in the media library, as
 * `safeMediaChanges()` would in the admin panel: files that aren't a kind the
 * site can use by the name they're saved under (an `.html` page would run on
 * the site's address), and SVGs that aren't already clean. The admin panel
 * sends files it has cleaned, so only what skipped it is refused.
 */
export function unsafeMediaChanges(changes: readonly FileChange[]): string[] {
  return changes.flatMap((change) => {
    if (!change.path.startsWith(`${MEDIA_DIR}/`) || "delete" in change) return [];
    const name = fileName(change.path);
    if (!mediaKind(name)) return [change.path];
    if (extensionOf(name) !== "svg") return [];
    const text = "bytes" in change ? new TextDecoder().decode(change.bytes) : change.content;
    return isCleanSvg(text) ? [] : [change.path];
  });
}
