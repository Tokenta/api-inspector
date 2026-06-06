/**
 * Model discovery + auth check.
 *
 * Calling `listModels` covers two questions in one round-trip:
 *   1. Auth: a 401/403 here proves the key is invalid; any 2xx proves it works.
 *   2. Discovery: which models the provider advertises via this key. We then
 *      compare against the seller's claimed model and emit a coarse match
 *      grade (`exact` / `family` / `not_advertised`).
 *
 * Returns two outcomes (auth + discovery) so the report renders them as
 * separate rows even though they share a network request.
 */

import type { CheckOutcome, ModelListResult, ProviderClient } from "../types.js";

export interface DiscoveryResult {
  authOutcome: CheckOutcome;
  discoveryOutcome: CheckOutcome;
  list: ModelListResult;
  matchGrade: "exact" | "family" | "absent" | "unknown";
}

export async function checkAuthAndDiscovery(
  client: ProviderClient,
  claimedModel?: string,
): Promise<DiscoveryResult> {
  const t0 = Date.now();
  const list = await client.listModels();
  const duration = Date.now() - t0;

  let authOutcome: CheckOutcome;
  if (!list.ok && (list.status === 401 || list.status === 403)) {
    authOutcome = {
      id: "auth",
      label: "Authentication",
      status: "fail",
      detail: `HTTP ${list.status}: ${list.errorMessage ?? "API key rejected"}`,
      durationMs: duration,
    };
  } else if (!list.ok && list.status === 0) {
    authOutcome = {
      id: "auth",
      label: "Authentication",
      status: "fail",
      detail: list.errorMessage ?? "Network error during auth probe",
      durationMs: duration,
    };
  } else if (!list.ok) {
    authOutcome = {
      id: "auth",
      label: "Authentication",
      status: "warn",
      detail: `HTTP ${list.status} (${list.errorMessage ?? "non-401 error"}) — auth likely OK but discovery failed`,
      durationMs: duration,
    };
  } else {
    authOutcome = {
      id: "auth",
      label: "Authentication",
      status: "pass",
      detail: `Key accepted by ${client.displayHost}`,
      durationMs: duration,
    };
  }

  let discoveryOutcome: CheckOutcome;
  let matchGrade: DiscoveryResult["matchGrade"] = "unknown";
  if (!list.ok) {
    discoveryOutcome = {
      id: "model-discovery",
      label: "Model discovery",
      status: list.status === 401 || list.status === 403 ? "skip" : "warn",
      detail: list.errorMessage ?? "Could not enumerate models",
      durationMs: duration,
      data: { status: list.status },
    };
  } else {
    const count = list.models.length;
    if (claimedModel) {
      const grade = compareClaimToList(claimedModel, list.models);
      matchGrade = grade;
      if (grade === "exact") {
        discoveryOutcome = {
          id: "model-discovery",
          label: "Model discovery",
          status: "pass",
          detail: `${claimedModel} is advertised (catalog: ${count} models)`,
          durationMs: duration,
          data: { models: list.models, claimed: claimedModel, grade },
        };
      } else if (grade === "family") {
        discoveryOutcome = {
          id: "model-discovery",
          label: "Model discovery",
          status: "warn",
          detail: `Exact "${claimedModel}" not in catalog, but a same-family model was found (${count} total)`,
          durationMs: duration,
          data: { models: list.models, claimed: claimedModel, grade },
        };
      } else {
        discoveryOutcome = {
          id: "model-discovery",
          label: "Model discovery",
          status: "warn",
          detail: `"${claimedModel}" is NOT advertised by this endpoint (${count} models listed)`,
          durationMs: duration,
          data: { models: list.models, claimed: claimedModel, grade },
        };
      }
    } else {
      discoveryOutcome = {
        id: "model-discovery",
        label: "Model discovery",
        status: "pass",
        detail: `Endpoint advertises ${count} models`,
        durationMs: duration,
        data: { models: list.models },
      };
    }
  }

  return { authOutcome, discoveryOutcome, list, matchGrade };
}

function compareClaimToList(claimed: string, models: string[]): "exact" | "family" | "absent" {
  const c = claimed.toLowerCase();
  if (models.some((m) => m.toLowerCase() === c)) return "exact";
  // Loose family match: same prefix up to a version separator.
  // e.g. claimed "gpt-4o" matches "gpt-4o-2024-08-06" or "gpt-4o-mini".
  const prefix = c.split(/[-:.]/)[0];
  if (prefix && models.some((m) => m.toLowerCase().startsWith(prefix))) return "family";
  return "absent";
}
