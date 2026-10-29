import { describe, expect, it } from "vitest";
import { cmdArgument, commandToRun } from "./node-command.js";

describe("commandToRun", () => {
  it("runs npm and npx through cmd.exe on Windows, with every argument quoted where it needs it", () => {
    expect(commandToRun("npx", ["--yes", "shadcn@3.1.0", "add", "https://example.org/r?a=1&b=2"], "win32")).toEqual({
      file: 'npx.cmd --yes shadcn@3.1.0 add "https://example.org/r?a=1&b=2"',
      args: [],
      shell: true,
    });
    expect(cmdArgument('say "hi"')).toBe('"say ""hi"""');
  });

  it("runs git without a shell, so a message with spaces stays one argument", () => {
    const message = ["commit", "--message", "Update the site's files for Goodfellow 0.7.0"];
    expect(commandToRun("git", message, "win32")).toEqual({ file: "git", args: message, shell: false });
    expect(commandToRun("npm", ["install"], "linux")).toEqual({ file: "npm", args: ["install"], shell: false });
  });
});
