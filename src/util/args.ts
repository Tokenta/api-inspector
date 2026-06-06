/**
 * Lightweight argv parser. Avoids a `commander` / `yargs` dependency.
 * Supports:
 *   - Positional command (e.g. "verify")
 *   - --flag value      (separate token)
 *   - --flag=value      (joined)
 *   - --boolean         (no value)
 *   - -h / --help shorthand
 */

export interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token) continue;

    if (token === "-h" || token === "--help") {
      flags.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      flags.version = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        const key = token.slice(2, eq);
        const value = token.slice(eq + 1);
        flags[key] = value;
        continue;
      }
      const key = token.slice(2);
      const next = args[i + 1];
      if (next != null && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (token.startsWith("-")) {
      flags[token.slice(1)] = true;
      continue;
    }

    if (command == null) {
      command = token;
    } else {
      positionals.push(token);
    }
  }

  return { command, flags, positionals };
}

export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true" || flags[key] === "1";
}

export function flagNumber(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const v = flagString(flags, key);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
