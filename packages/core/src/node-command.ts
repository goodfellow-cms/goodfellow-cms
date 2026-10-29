// Starting other programs the same way on every computer. npm and npx are .cmd files on Windows, which Node
// starts only through cmd.exe, and Node then joins the arguments with spaces as they are, so they're quoted here.

/** An argument as cmd.exe reads it: as it is where it's plain, and otherwise in double quotes, its own doubled. */
export function cmdArgument(arg: string): string {
  return /^[\w@+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`;
}

/**
 * What to give `spawn()` or `execFile()` to run `command` with `args`: on
 * Windows, npm and npx (`npm.cmd`, `npx.cmd`) as one quoted line through
 * cmd.exe, and every other program, such as git, without a shell, so no
 * argument is read twice.
 */
export function commandToRun(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; shell: boolean } {
  const name = command.replace(/\.cmd$/i, "");
  if (platform !== "win32" || (name !== "npm" && name !== "npx"))
    return { file: command, args: [...args], shell: false };
  return { file: [`${name}.cmd`, ...args.map(cmdArgument)].join(" "), args: [], shell: true };
}
