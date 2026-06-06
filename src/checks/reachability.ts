/**
 * Reachability check: confirms the base host accepts a TLS handshake and
 * responds at all (any HTTP status). Auth is intentionally not validated here
 * — that is the next check.
 */

import { httpRequest } from "../util/http.js";
import type { CheckOutcome, ProviderClient } from "../types.js";

export async function checkReachability(client: ProviderClient): Promise<CheckOutcome> {
  const t0 = Date.now();
  // Hitting the base URL with no auth: most providers return 401/404. Either
  // is a positive "the server is alive" signal. Only network errors count
  // as failures here.
  const res = await httpRequest(client.baseUrl, { method: "GET", timeoutMs: 10_000 });
  const duration = Date.now() - t0;

  if (res.errorCode === "TIMEOUT") {
    return {
      id: "reachability",
      label: "Endpoint reachability",
      status: "fail",
      detail: `Timed out reaching ${client.displayHost}`,
      durationMs: duration,
    };
  }
  if (res.errorCode === "NETWORK") {
    return {
      id: "reachability",
      label: "Endpoint reachability",
      status: "fail",
      detail: res.errorMessage ?? `Could not reach ${client.displayHost}`,
      durationMs: duration,
    };
  }
  return {
    id: "reachability",
    label: "Endpoint reachability",
    status: "pass",
    detail: `${client.displayHost} responded with HTTP ${res.status}`,
    durationMs: duration,
    data: { status: res.status, latencyMs: res.latencyMs },
  };
}
