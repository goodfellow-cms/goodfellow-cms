/**
 * Blocks' icons in the editor's block list (Puck's `drawerItem` override, and
 * the block search's results): the block's own from `withIcon()`, drawn from
 * its shapes, in place of Puck's drag handle, which every block shares.
 * Blocks without one get a plain box.
 */
import type { BlockIcon } from "@goodfellow-cms/core";
import { Box } from "lucide-react";
import { createElement, type ReactNode } from "react";

/** A block's icon, at the block list's size, in the text's color. */
export function BlockIconSvg({ icon }: { icon?: BlockIcon | undefined }) {
  if (!icon) return <Box className="gfa-block-icon" size={16} strokeWidth={2} aria-hidden="true" />;
  return (
    <svg
      className="gfa-block-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon.map(([shape, attributes], index) =>
        // Shapes are the ones `cleanBlockIcon()` keeps, with only the attributes that place them.
        createElement(shape, { key: index, ...attributes }),
      )}
    </svg>
  );
}

/** Puck's block list item, with the block's icon before its name. */
export function drawerItemWithIcon(icons: ReadonlyMap<string, BlockIcon>) {
  return function DrawerItemWithIcon({ children, name }: { children: ReactNode; name: string }) {
    return (
      <div className="gfa-drawer-item">
        <BlockIconSvg icon={icons.get(name)} />
        {children}
      </div>
    );
  };
}
