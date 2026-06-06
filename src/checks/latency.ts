/**
 * Latency benchmark.
 *
 * Sends `samples` very small chat requests sequentially and reports p50 / p95
 * round-trip latency. We deliberately serialize the probes — concurrent probes
 * would understate cold-start cost and could trip rate limits on free tiers.
 */

import type { CheckOutcome, ProviderClient } from "../types.js";

export interface LatencyResult {
  outcome: CheckOutcome;
  p50?: number;
  p95?: number;
  samples: number[];
}

export async function checkLatency(
  client: ProviderClient,
  model: string,
  options: { samples?: number; timeoutMs?: number } = {},
): Promise<LatencyResult> {
  const samples = Math.max(1, Math.min(options.samples ?? 5, 20));
  const collected: number[] = [];
  let firstErr: string | undefined;

  for (let i = 0; i < samples; i++) {
    const res = await client.chat({
      model,
      messages: [
        { role: "system", content: "Reply with exactly one word: OK" },
        { role: "user", content: "ping" },
      ],
      maxTokens: 4,
      temperature: 0,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    if (res.ok) {
      collected.push(res.latencyMs);
    } else if (firstErr == null) {
      firstErr = `HTTP ${res.status}: ${res.errorMessage ?? "request failed"}`;
    }
  }

  if (collected.length === 0) {
    return {
      outcome: {
        id: "latency",
        label: "Latency benchmark",
        status: "fail",
        detail: firstErr ?? "All latency probes failed",
        data: { samples: 0 },
      },
      samples: [],
    };
  }

  const p50 = percentile(collected, 50);
  const p95 = percentile(collected, 95);
  // Sub-2s p95 is a healthy signal for small replies on most providers.
  const status = p95 < 2_000 ? "pass" : p95 < 6_000 ? "warn" : "fail";
  return {
    outcome: {
      id: "latency",
      label: "Latency benchmark",
      status,
      detail: `p50 ${p50} ms, p95 ${p95} ms (${collected.length}/${samples} successful)`,
      data: { p50, p95, samples: collected },
    },
    p50,
    p95,
    samples: collected,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank method is stable for tiny n; we run with n=5 by default.
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}
