/**
 * Tiny interactive prompt helpers built on Node's `readline/promises`.
 * Used only when the CLI runs in interactive mode (no flags supplied).
 *
 * `secret` masks input by writing asterisks back to the terminal — note that
 * Node has no portable equivalent of POSIX termios, so for true terminal
 * masking we rely on `_writeToOutput` override, which is a documented Node
 * pattern. When stdin is not a TTY (e.g. piped input) we fall back to a
 * non-masked read.
 */

import { createInterface, type Interface } from "node:readline";

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  } finally {
    rl.close();
  }
}

export async function askSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Cast to access the private `_writeToOutput` override used for masking.
  const muted = rl as unknown as Interface & { _writeToOutput?: (s: string) => void };
  let muting = false;
  const originalWrite = muted._writeToOutput?.bind(muted);
  if (originalWrite && process.stdin.isTTY) {
    muted._writeToOutput = (stringToWrite: string) => {
      if (!muting) {
        originalWrite(stringToWrite);
        return;
      }
      // Preserve newlines so the prompt renders correctly on submit.
      if (stringToWrite === "\r\n" || stringToWrite === "\n") {
        originalWrite(stringToWrite);
        return;
      }
      originalWrite("*".repeat(stringToWrite.length));
    };
  }
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
      muting = true;
    });
  } finally {
    rl.close();
  }
}

export async function askChoice<T extends string>(
  question: string,
  choices: { value: T; label: string }[],
): Promise<T> {
  const lines: string[] = [question];
  choices.forEach((choice, i) => {
    lines.push(`  ${i + 1}. ${choice.label}`);
  });
  const formatted = `${lines.join("\n")}\n> `;
  const raw = await ask(formatted);
  const idx = Number.parseInt(raw, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
    return choices[idx - 1]!.value;
  }
  // Fallback: match by value or label prefix.
  const lowered = raw.toLowerCase();
  const match = choices.find(
    (choice) =>
      choice.value.toLowerCase() === lowered ||
      choice.label.toLowerCase().startsWith(lowered),
  );
  if (match) return match.value;
  // Default to the first choice if input was ambiguous.
  return choices[0]!.value;
}
