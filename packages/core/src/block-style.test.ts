import { describe, expect, it } from "vitest";
import { type BlockStyle, blockStyleClasses, customLength, readBlockStyle, withBlockStyle } from "./block-style.js";

describe("block styles", () => {
  it("reads a block's classes as its style, keeping the rest in order", () => {
    expect(
      readBlockStyle(
        "shadow md:p-8 text-center text-lg text-primary-foreground bg-[#1D4ED8] px-4 py-2 mt-6 rounded-xl",
      ),
    ).toEqual({
      style: {
        align: "center",
        fontSize: "lg",
        color: "primary-foreground",
        background: "#1d4ed8",
        padding: { top: "2", right: "4", bottom: "2", left: "4" },
        margin: { top: "6" },
        radius: "xl",
      },
      other: ["shadow", "md:p-8"],
    });
  });

  it("reads lengths of an editor's own, and leaves classes it doesn't cover alone", () => {
    expect(readBlockStyle("text-[18px] p-[13px] rounded-[3px] text-white bg-[var(--x)] mx-auto -mt-4 rounded")).toEqual(
      {
        style: {
          fontSize: "18px",
          padding: { top: "13px", right: "13px", bottom: "13px", left: "13px" },
          radius: "3px",
        },
        other: ["text-white", "bg-[var(--x)]", "mx-auto", "-mt-4", "rounded"],
      },
    );
    expect(readBlockStyle(undefined)).toEqual({ style: {}, other: [] });
  });

  it("lets later classes win, as a block's merged classes do", () => {
    expect(readBlockStyle("p-2 p-4 pt-8").style.padding).toEqual({ top: "8", right: "4", bottom: "4", left: "4" });
  });

  it("writes a style as the fewest classes", () => {
    expect(blockStyleClasses({ padding: { top: "4", right: "4", bottom: "4", left: "4" } })).toEqual(["p-4"]);
    expect(blockStyleClasses({ padding: { top: "2", bottom: "2", left: "0", right: "0" } })).toEqual(["px-0", "py-2"]);
    expect(blockStyleClasses({ margin: { top: "6", left: "13px" } })).toEqual(["ml-[13px]", "mt-6"]);
    expect(
      blockStyleClasses({ align: "right", fontSize: "18px", color: "#ff0000", background: "muted", radius: "full" }),
    ).toEqual(["text-right", "text-[18px]", "text-[#ff0000]", "bg-muted", "rounded-full"]);
  });

  it("leaves out values a class can't say", () => {
    expect(
      blockStyleClasses({
        fontSize: "huge",
        color: "red;}",
        background: "url(x)",
        padding: { top: "1em]" },
        radius: "[x]",
      }),
    ).toEqual([]);
  });

  it("keeps the other classes first, so the style wins, and reads back what it writes", () => {
    const { style, other } = readBlockStyle("shadow p-2");
    const className = withBlockStyle(other, { ...style, align: "center" });
    expect(className).toBe("shadow text-center p-2");
    expect(readBlockStyle(className)).toEqual({ style: { ...style, align: "center" }, other: ["shadow"] });
    expect(withBlockStyle([], {})).toBe("");
  });

  it("tidies lengths an editor types", () => {
    expect(customLength("13")).toBe("13px");
    expect(customLength(" 1.5 REM ")).toBe("1.5rem");
    expect(customLength("0")).toBe("0px");
    expect(customLength("big")).toBeUndefined();
  });

  it("hides a block on sizes of screen with the fewest of Tailwind's breakpoint classes", () => {
    const write = (hiddenOn: BlockStyle["hiddenOn"]) => blockStyleClasses({ hiddenOn });
    expect(write(["phones"])).toEqual(["max-sm:hidden"]);
    expect(write(["tablets"])).toEqual(["sm:max-lg:hidden"]);
    expect(write(["computers"])).toEqual(["lg:hidden"]);
    expect(write(["phones", "tablets"])).toEqual(["max-lg:hidden"]);
    expect(write(["tablets", "computers"])).toEqual(["sm:hidden"]);
    expect(write(["phones", "computers"])).toEqual(["max-sm:hidden", "lg:hidden"]);
    expect(write(["phones", "tablets", "computers"])).toEqual(["max-lg:hidden", "lg:hidden"]);
    expect(write([])).toEqual([]);
    expect(readBlockStyle("flex sm:hidden max-sm:hidden").style.hiddenOn).toEqual(["phones", "tablets", "computers"]);
    expect(readBlockStyle("lg:hidden p-4").style).toEqual({
      hiddenOn: ["computers"],
      padding: { top: "4", right: "4", bottom: "4", left: "4" },
    });
    // Plain `hidden` is a block's own, such as a dark logo's `hidden dark:block`.
    expect(readBlockStyle("hidden dark:block")).toEqual({ style: {}, other: ["hidden", "dark:block"] });
    expect(readBlockStyle("md:hidden").other).toEqual(["md:hidden"]);
  });
});
