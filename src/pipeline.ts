/**
 * Inspection pipeline.
 *
 * Sequence is intentional:
 *   1. Reachability      — fast, cheap. Bails if the host is dead.
 *   2. Auth + discovery  — single round-trip, gates everything else.
 *   3. Latency           — small probes, also harvests rate-limit headers
 *                          for the rate-limit check.
 *   4. Context           — most expensive; skipped on auth failure or --quick.
 *   5. Fingerprint       — identity probes; depends on a working chat.
 *   6. Rate limit        — header inspection from the latency probe response.
 *
 * The pipeline never throws; it returns a populated `InspectionReport` even
 * when individual checks fail. Failures are encoded into the report so the
 * --json output is always machine-readable.
 */

import type { InspectionReport, ProviderClient, ProviderConfig, CheckOutcome } from "./types.js";
import { createProviderClient } from "./providers/index.js";
import { checkReachability } from "./checks/reachability.js";
import { checkAuthAndDiscovery, type DiscoveryResult } from "./checks/model-discovery.js";
import { checkLatency } from "./checks/latency.js";
import { checkContext } from "./checks/context.js";
import { checkFingerprint } from "./checks/fingerprint.js";
import { checkRateLimit } from "./checks/rate-limit.js";
import { computeTrustScore } from "./scoring.js";

export interface PipelineOptions {
  quick?: boolean;
  fullContext?: boolean;
  latencySamples?: number;
  timeoutMs?: number;
  toolVersion: string;
}

export async function runInspection(
  config: ProviderConfig,
  options: PipelineOptions,
): Promise<InspectionReport> {
  const startedAt = new Date().toISOString();
  const client = createProviderClient(config);
  const checks: CheckOutcome[] = [];

  // ---- 1. Reachability ----
  const reach = await checkReachability(client);
  checks.push(reach);

  if (reach.status === "fail") {
    return finalize({
      client,
      checks,
      startedAt,
      claimedModel: config.claimedModel,
      toolVersion: options.toolVersion,
    });
  }

  // ---- 2. Auth + discovery ----
  const discovery: DiscoveryResult = await checkAuthAndDiscovery(client, config.claimedModel);
  checks.push(discovery.authOutcome);
  checks.push(discovery.discoveryOutcome);

  if (discovery.authOutcome.status === "fail") {
    return finalize({
      client,
      checks,
      startedAt,
      claimedModel: config.claimedModel,
      toolVersion: options.toolVersion,
      matchGrade: discovery.matchGrade,
    });
  }

  // Pick a model to use for the active probes:
  //   1. Seller's claim (we are auditing them on their advertised product).
  //   2. First model the endpoint returned.
  //   3. Provider's hard-coded default model.
  const probeModel = config.claimedModel ?? discovery.list.models[0] ?? client.defaultModel;

  // ---- 3. Latency ----
  const latencyResult = await checkLatency(client, probeModel, {
    samples: options.latencySamples,
    timeoutMs: options.timeoutMs,
  });
  checks.push(latencyResult.outcome);

  // ---- 4. Context probe ----
  const ctxResult = await checkContext(client, probeModel, {
    quick: options.quick,
    fullContext: options.fullContext,
    timeoutMs: options.timeoutMs,
  });
  checks.push(ctxResult.outcome);

  // ---- 5. Fingerprint ----
  const fpResult = await checkFingerprint(client, probeModel, config.claimedModel, {
    timeoutMs: options.timeoutMs,
  });
  checks.push(fpResult.outcome);

  // ---- 6. Rate-limit header inspection ----
  // Use headers from the latency probe; latency.ts records sample timings only,
  // so we re-extract from a single representative ping. To keep this dependency
  // free and to avoid extra requests, we read whichever headers we can find on
  // the discovery response (servers usually expose them on /models too).
  const rl = checkRateLimit(discovery.list.rawHeaders);
  checks.push(rl.outcome);

  return finalize({
    client,
    checks,
    startedAt,
    claimedModel: config.claimedModel,
    toolVersion: options.toolVersion,
    matchGrade: discovery.matchGrade,
    fingerprintConfidence: fpResult.confidence,
    fingerprintMismatch: fpResult.claimMismatch,
    detectedVendor: fpResult.detectedVendor,
    detectedFamily: fpResult.detectedFamily,
    contextWindowObserved: ctxResult.observedTokens,
    latencyP50: latencyResult.p50,
    latencyP95: latencyResult.p95,
    rateLimitHeader: rl.headerValue,
  });
}

interface FinalizeArgs {
  client: ProviderClient;
  checks: CheckOutcome[];
  startedAt: string;
  claimedModel?: string;
  toolVersion: string;
  matchGrade?: DiscoveryResult["matchGrade"];
  fingerprintConfidence?: number;
  fingerprintMismatch?: boolean;
  detectedVendor?: string;
  detectedFamily?: string;
  contextWindowObserved?: number;
  latencyP50?: number;
  latencyP95?: number;
  rateLimitHeader?: string;
}

function finalize(args: FinalizeArgs): InspectionReport {
  const { score, verdict } = computeTrustScore({
    checks: args.checks,
    matchGrade: args.matchGrade,
    fingerprintConfidence: args.fingerprintConfidence,
    fingerprintMismatch: args.fingerprintMismatch,
  });

  return {
    startedAt: args.startedAt,
    finishedAt: new Date().toISOString(),
    provider: args.client.name,
    displayHost: args.client.displayHost,
    baseUrl: args.client.baseUrl,
    claimedModel: args.claimedModel,
    detectedModel: args.detectedVendor
      ? `${args.detectedVendor}${args.detectedFamily ? ` (${args.detectedFamily})` : ""}`
      : undefined,
    detectedConfidence: args.fingerprintConfidence,
    contextWindowObserved: args.contextWindowObserved,
    latencyP50Ms: args.latencyP50,
    latencyP95Ms: args.latencyP95,
    rateLimitHeader: args.rateLimitHeader,
    fingerprintNote: args.fingerprintMismatch
      ? "Fingerprint contradicts the seller's claimed model."
      : undefined,
    checks: args.checks,
    trustScore: score,
    verdict,
    toolVersion: args.toolVersion,
  };
}
