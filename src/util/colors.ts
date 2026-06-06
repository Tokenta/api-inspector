/**
 * Tiny ANSI helper. We avoid `chalk` / `picocolors` to keep the install
 * footprint at zero runtime deps (the entire CLI ships only @types/node and
 * typescript as dev deps). Color is auto-disabled when stdout is not a TTY,
 * when NO_COLOR is set, or when `--no-color` is passed.
 */

const env = process.env;
let enabled =
  process.stdout.isTTY === true &&
  !("NO_COLOR" in env) &&
  env.TERM !== "dumb" &&
  !process.argv.includes("--no-color");

export function setColorEnabled(value: boolean): void {
  enabled = value;
}

export function isColorEnabled(): boolean {
  return enabled;
}

function wrap(open: number, close: number) {
  return (text: string | number) => {
    if (!enabled) return String(text);
    return `\u001b[${open}m${text}\u001b[${close}m`;
  };
}

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  bgRed: wrap(41, 49),
  bgGreen: wrap(42, 49),
  bgYellow: wrap(43, 49),
};

/** Symbols used in check rows. ASCII-only for cross-terminal compatibility. */
export const SYM = {
  pass: "[OK]",
  warn: "[!!]",
  fail: "[XX]",
  skip: "[--]",
  arrow: "->",
};

export function statusBadge(status: "pass" | "warn" | "fail" | "skip"): string {
  switch (status) {
    case "pass":
      return c.green(SYM.pass);
    case "warn":
      return c.yellow(SYM.warn);
    case "fail":
      return c.red(SYM.fail);
    case "skip":
      return c.gray(SYM.skip);
  }
}
