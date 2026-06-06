/**
 * Factory that selects the right provider client given a `ProviderConfig`.
 */

import type { ProviderClient, ProviderConfig } from "../types.js";
import { createOpenAIClient } from "./openai.js";
import { createAnthropicClient } from "./anthropic.js";
import { createGeminiClient } from "./gemini.js";
import { createCustomClient } from "./custom.js";

export function createProviderClient(config: ProviderConfig): ProviderClient {
  switch (config.provider) {
    case "openai":
      return createOpenAIClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "anthropic":
      return createAnthropicClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "gemini":
      return createGeminiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "custom":
      if (!config.baseUrl) {
        throw new Error("provider 'custom' requires a baseUrl (use --base-url)");
      }
      return createCustomClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }
}
