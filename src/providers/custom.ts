/**
 * Custom OpenAI-compatible provider client.
 *
 * Most LLM resellers, marketplaces, and gateways (the exact use case API
 * Inspector is designed to audit) expose an OpenAI-compatible surface. We
 * reuse the OpenAI client implementation but stamp the result with the
 * "custom" provider name so reports clearly indicate the endpoint is not
 * canonical OpenAI.
 */

import { createOpenAIClient } from "./openai.js";
import type { ProviderClient } from "../types.js";

interface CustomArgs {
  apiKey: string;
  baseUrl: string;
  defaultModel?: string;
}

export function createCustomClient(args: CustomArgs): ProviderClient {
  return createOpenAIClient({
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    providerName: "custom",
    defaultModel: args.defaultModel,
  });
}
