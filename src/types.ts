/**
 * Shared types for API Inspector.
 *
 * The pipeline is intentionally provider-agnostic: every supported provider
 * (OpenAI, Anthropic, Gemini, OpenAI-compatible custom endpoints) implements
 * the same `ProviderClient` interface so checks can run unchanged across them.
 */

export type ProviderName = "openai" | "anthropic" | "gemini" | "custom";

export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl?: string;
  claimedModel?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  ok: boolean;
  status: number;
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  rawHeaders: Record<string, string>;
  errorMessage?: string;
  errorCode?: string;
}

export interface ModelListResult {
  ok: boolean;
  status: number;
  models: string[];
  rawHeaders: Record<string, string>;
  errorMessage?: string;
}

export interface ProviderClient {
  readonly name: ProviderName;
  /** Human-readable host (e.g. "api.openai.com"). */
  readonly displayHost: string;
  /** Full base URL the client will hit (without trailing slash). */
  readonly baseUrl: string;
  /** A model name the provider can be expected to ship; used as a fallback. */
  readonly defaultModel: string;
  listModels(): Promise<ModelListResult>;
  chat(options: ChatOptions): Promise<ChatResult>;
}

/* ---------- check results ---------- */

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckOutcome {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

export interface InspectionReport {
  /** ISO timestamp at which the inspection started. */
  startedAt: string;
  finishedAt: string;
  provider: ProviderName;
  displayHost: string;
  baseUrl: string;
  claimedModel?: string;
  detectedModel?: string;
  detectedConfidence?: number;
  contextWindowObserved?: number;
  contextWindowClaimed?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  rateLimitHeader?: string;
  fingerprintNote?: string;
  checks: CheckOutcome[];
  trustScore: number;
  verdict: "VERIFIED" | "SUSPECT" | "HIGH_RISK";
  toolVersion: string;
}
