/**
 * Rate-limit header inspection.
 *
 * Many providers (OpenAI canonical, plus most OpenAI-compat gateways) expose
 * `x-ratelimit-*` response headers indicating per-minute / per-day caps on
 * requests and tokens. Resold endpoints often strip or fake these.
 *
 * This check inspects the headers from the most recent successful chat we
 * already made elsewhere in the pipeline (passed in by the caller) — we do
 * NOT issue an extra request just to read headers.
 */

import type { CheckOutcome } from "../types.js";

export interface RateLimitResult {
  outcome: CheckOutcome;
  headerValue?: string;
}

const KNOWN_HEADERS = [
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-tokens",
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-tokens-limit",
];

export function checkRateLimit(headers: Record<string, string> | undefined): RateLimitResult {
  if (!headers) {
    return {
      outcome: {
        id: "rate-limit",
        label: "Rate-limit headers",
        status: "skip",
        detail: "No prior successful response to inspect",
      },
    };
  }
  const present = KNOWN_HEADERS.filter((h) => headers[h] != null);
  if (present.length === 0) {
    return {
      outcome: {
        id: "rate-limit",
        label: "Rate-limit headers",
        status: "warn",
        detail: "No standard rate-limit headers exposed (transparency concern on resold endpoints)",
      },
    };
  }
  const summary = present.map((h) => `${h}=${headers[h]}`).join(", ");
  const reqLimit =
    headers["x-ratelimit-limit-requests"] ?? headers["anthropic-ratelimit-requests-limit"];
  const headerValue = reqLimit ? `${reqLimit} req/min (header reported)` : summary.slice(0, 120);
  return {
    outcome: {
      id: "rate-limit",
      label: "Rate-limit headers",
      status: "pass",
      detail: `${present.length} rate-limit headers exposed`,
      data: { headers: present.reduce<Record<string, string>>((acc, key) => {
        acc[key] = headers[key]!;
        return acc;
      }, {}) },
    },
    headerValue,
  };
}
