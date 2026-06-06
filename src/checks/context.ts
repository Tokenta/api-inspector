/**
 * Context window probe.
 *
 * Strategy: send a unique 6-character canary at the START of a synthetic prompt
 * padded with predictable filler tokens, then ask the model to repeat the canary
 * back. If the canary appears in the reply, the model successfully attended to a
 * prompt of the probed size. We escalate sizes in capped steps until either the
 * model fails (truncates / hallucinates) or returns a context-length error.
 *
 * This is intentionally conservative on token usage — it's the most expensive
 * check in the suite, so the default ladder caps at 32K. Pass `--full-context`
 * to extend to 128K.
 *
 * The probe is heuristic, not perfect. Some providers silently truncate without
 * an error; in that case we stop at the largest size that returned the canary.
 */

import type { CheckOutcome, ProviderClient } from "../types.js";

const DEFAULT_LADDER_TOKENS = [1_000, 4_000, 16_000, 32_000];
const FULL_LADDER_TOKENS = [1_000, 4_000, 16_000, 32_000, 64_000, 128_000];
/** Approx chars per token for English filler. Conservative to avoid overflow. */
const CHARS_PER_TOKEN = 4;

export interface ContextResult {
  outcome: CheckOutcome;
  observedTokens?: number;
}

export async function checkContext(
  client: ProviderClient,
  model: string,
  options: { fullContext?: boolean; quick?: boolean; timeoutMs?: number } = {},
): Promise<ContextResult> {
  if (options.quick) {
    return {
      outcome: {
        id: "context",
        label: "Context window probe",
        status: "skip",
        detail: "Skipped (--quick)",
      },
    };
  }
  const ladder = options.fullContext ? FULL_LADDER_TOKENS : DEFAULT_LADDER_TOKENS;
  let lastObserved: number | undefined;
  let lastError: string | undefined;

  for (const target of ladder) {
    const canary = makeCanary();
    const filler = makeFiller(target - 64); // leave room for instructions + canary
    const userPrompt =
      `CANARY=${canary}\n` +
      `BEGIN_FILLER\n${filler}\nEND_FILLER\n` +
      `Repeat the canary token after CANARY= exactly. Reply with just the canary, no other text.`;
    const res = await client.chat({
      model,
      messages: [
        { role: "system", content: "You are an echo function. Obey the user precisely." },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 32,
      temperature: 0,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    if (!res.ok) {
      // Common context-too-large signatures: 400 with messages mentioning
      // "context" or "maximum context length".
      const msg = (res.errorMessage ?? "").toLowerCase();
      if (
        res.status === 400 &&
        (msg.includes("context") ||
          msg.includes("maximum") ||
          msg.includes("token") ||
          msg.includes("length"))
      ) {
        break;
      }
      lastError = res.errorMessage ?? `HTTP ${res.status}`;
      break;
    }
    if (res.text.includes(canary)) {
      lastObserved = target;
      continue;
    }
    // Model returned a reply but did not echo the canary — assume truncation
    // happened above this size; stop and report the previous tier.
    break;
  }

  if (lastObserved == null) {
    return {
      outcome: {
        id: "context",
        label: "Context window probe",
        status: "fail",
        detail: lastError ?? "Could not confirm any context window size",
      },
    };
  }

  const observed = lastObserved;
  const status = observed >= 16_000 ? "pass" : "warn";
  return {
    outcome: {
      id: "context",
      label: "Context window probe",
      status,
      detail: `Confirmed at ${formatTokens(observed)} tokens`,
      data: { observedTokens: observed, ladder },
    },
    observedTokens: observed,
  };
}

function makeCanary(): string {
  // 6-char alphanumeric token. Random enough to avoid pre-existing matches in
  // the filler text we generate ourselves.
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeFiller(targetTokens: number): string {
  if (targetTokens <= 0) return "";
  const word = "lorem ipsum dolor sit amet ";
  const targetChars = Math.max(0, targetTokens * CHARS_PER_TOKEN);
  const repeat = Math.ceil(targetChars / word.length);
  return word.repeat(repeat).slice(0, targetChars);
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
