/**
 * Anthropic provider client (Claude family).
 *
 * Notes vs OpenAI:
 *   - Auth uses `x-api-key` (not Authorization: Bearer ...).
 *   - Requires `anthropic-version` header.
 *   - Chat lives at `/v1/messages`; system prompt is a top-level `system` field,
 *     not embedded in `messages`.
 *   - The newer `/v1/models` endpoint exists, so we try it for discovery and
 *     gracefully fall back to a known set if the deployment 404s.
 */

import { httpRequest, joinUrl } from "../util/http.js";
import type {
  ChatOptions,
  ChatResult,
  ModelListResult,
  ProviderClient,
} from "../types.js";

const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-haiku-latest";

const ANTHROPIC_FALLBACK_MODELS = [
  "claude-3-5-haiku-latest",
  "claude-3-5-sonnet-latest",
  "claude-3-7-sonnet-latest",
  "claude-3-opus-latest",
];

interface AnthropicArgs {
  apiKey: string;
  baseUrl?: string;
}

export function createAnthropicClient(args: AnthropicArgs): ProviderClient {
  const baseUrl = (args.baseUrl ?? ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, "");
  const displayHost = hostFromUrl(baseUrl) ?? "api.anthropic.com";

  const authHeaders = (): Record<string, string> => ({
    "x-api-key": args.apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
    "Content-Type": "application/json",
  });

  return {
    name: "anthropic",
    displayHost,
    baseUrl,
    defaultModel: ANTHROPIC_DEFAULT_MODEL,

    async listModels(): Promise<ModelListResult> {
      const res = await httpRequest(joinUrl(baseUrl, "models"), {
        method: "GET",
        headers: authHeaders(),
        timeoutMs: 20_000,
      });
      if (res.errorCode) {
        return {
          ok: false,
          status: 0,
          models: [],
          rawHeaders: res.headers,
          errorMessage: res.errorMessage,
        };
      }
      if (res.status === 404) {
        // Older Anthropic deployments do not expose /models. Treat as a soft success
        // with the public catalog so downstream checks still have something to score.
        return {
          ok: true,
          status: 200,
          models: ANTHROPIC_FALLBACK_MODELS,
          rawHeaders: res.headers,
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          models: [],
          rawHeaders: res.headers,
          errorMessage: extractAnthropicError(res.text),
        };
      }
      const body = res.json<{ data?: { id: string }[] }>();
      const models = (body?.data ?? [])
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter(Boolean);
      return { ok: true, status: res.status, models, rawHeaders: res.headers };
    },

    async chat(opts: ChatOptions): Promise<ChatResult> {
      // Anthropic separates system prompt from `messages`.
      const system = opts.messages.find((m) => m.role === "system")?.content;
      const userMessages = opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const payload: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens ?? 256,
        messages: userMessages,
        temperature: opts.temperature ?? 0,
      };
      if (system) payload.system = system;

      const res = await httpRequest(joinUrl(baseUrl, "messages"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
        timeoutMs: opts.timeoutMs ?? 30_000,
      });
      if (res.errorCode) {
        return {
          ok: false,
          status: 0,
          text: "",
          latencyMs: res.latencyMs,
          rawHeaders: res.headers,
          errorMessage: res.errorMessage,
          errorCode: res.errorCode,
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          text: "",
          latencyMs: res.latencyMs,
          rawHeaders: res.headers,
          errorMessage: extractAnthropicError(res.text),
          errorCode: extractAnthropicErrorType(res.text),
        };
      }
      const body = res.json<{
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      }>();
      const text = (body?.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text!)
        .join("");
      return {
        ok: true,
        status: res.status,
        text,
        promptTokens: body?.usage?.input_tokens,
        completionTokens: body?.usage?.output_tokens,
        totalTokens:
          (body?.usage?.input_tokens ?? 0) + (body?.usage?.output_tokens ?? 0) || undefined,
        latencyMs: res.latencyMs,
        rawHeaders: res.headers,
      };
    },
  };
}

function hostFromUrl(raw: string): string | null {
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function extractAnthropicError(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    /* fall through */
  }
  return text ? text.slice(0, 200) : undefined;
}

function extractAnthropicErrorType(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { type?: string } };
    return parsed?.error?.type;
  } catch {
    return undefined;
  }
}
