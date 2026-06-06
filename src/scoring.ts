/**
 * Trust score aggregation.
 *
 * The score is intentionally explainable — every contribution is a fixed
 * additive weight tied to a specific check outcome. We do NOT use opaque ML
 * scoring; users (and contributors) need to be able to read the math and
 * argue with it.
 *
 * Weights (sum = 100):
 *   Authentication ............................ 20
 *   Reachability ..............................  5
 *   Model discovery (claim match) ............. 20
 *   Fingerprint vs claim ...................... 25
 *   Context window probe ...................... 10
 *   Latency p95 ............................... 10
 *   Rate-limit header transparency ............ 10
 *
 * Verdict thresholds:
 *   >= 80 -> VERIFIED
 *   60-79 -> SUSPECT
 *   <  60 -> HIGH_RISK
 */

import type { CheckOutcome, InspectionReport } from "./types.js";

export interface ScoreInputs {
  checks: CheckOutcome[];
  matchGrade?: "exact" | "family" | "absent" | "unknown";
  fingerprintConfidence?: number;
  fingerprintMismatch?: boolean;
}

export function computeTrustScore(inputs: ScoreInputs): {
  score: number;
  verdict: InspectionReport["verdict"];
} {
  const byId = new Map(inputs.checks.map((c) => [c.id, c] as const));
  let score = 0;

  // Reachability: 5
  if (statusOf(byId, "reachability") === "pass") score += 5;

  // Authentication: 20 (gate; if fail, almost everything else is skipped)
  if (statusOf(byId, "auth") === "pass") score += 20;

  // Model discovery vs claimed: 20
  if (inputs.matchGrade === "exact") score += 20;
  else if (inputs.matchGrade === "family") score += 10;
  else if (inputs.matchGrade === "unknown") score += 5; // discovery couldn't run

  // Fingerprint vs claim: 25
  // - Match: full 25
  // - Mismatch: -10 (heavy penalty — this is the core anti-fraud signal)
  // - Inconclusive: 5 (we don't reward suppression, but we don't punish either)
  if (inputs.fingerprintMismatch) score -= 10;
  else if (statusOf(byId, "fingerprint") === "pass") {
    const conf = inputs.fingerprintConfidence ?? 0;
    score += conf >= 80 ? 25 : conf >= 50 ? 18 : 12;
  } else if (statusOf(byId, "fingerprint") === "warn") {
    score += 5;
  }

  // Context: 10
  const ctx = byId.get("context");
  if (ctx?.status === "pass") score += 10;
  else if (ctx?.status === "warn") score += 5;

  // Latency: 10
  const lat = byId.get("latency");
  if (lat?.status === "pass") score += 10;
  else if (lat?.status === "warn") score += 5;

  // Rate-limit: 10 (transparency bonus)
  const rl = byId.get("rate-limit");
  if (rl?.status === "pass") score += 10;
  else if (rl?.status === "warn") score += 3;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: InspectionReport["verdict"] =
    clamped >= 80 ? "VERIFIED" : clamped >= 60 ? "SUSPECT" : "HIGH_RISK";
  return { score: clamped, verdict };
}

function statusOf(map: Map<string, CheckOutcome>, id: string): CheckOutcome["status"] | undefined {
  return map.get(id)?.status;
}
