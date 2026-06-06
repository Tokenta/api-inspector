/**
 * OpenAI provider client.
 *
 * Also covers any OpenAI-compatible endpoint when constructed via
 * `createOpenAICompatibleClient` from ./custom.ts (sellers, gateways, Azure
 * OpenAI when the deployment exposes the standard /chat/completions surface).
 */

import { httpRequest, joinUrl } from "../util/http.js";
import type {
  ChatOptions,
  ChatResult,
  ModelListResult,
  ProviderClient,
  ProviderName,
} from "../types.js";

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIClientArgs {
  apiKey: string;
  baseUrl?: string;
  /** Used for fingerprint output ("api.openai.com" vs the actual host). */
  displayHost?: string;
  /** Internal: lets `custom` providers reuse this implementation. */
  providerName?: ProviderName;
  defaultModel?: string;
}

export function createOpenAIClient(args: OpenAIClientArgs): ProviderClient {
  const baseUrl = (args.baseUrl ?? OPENAI_DEFAULT_BASE).replace(/\/+$/, "");
  const displayHost = args.displayHost ?? hostFromUrl(baseUrl) ?? "api.openai.com";
  const providerName: ProviderName = args.providerName ?? "openai";
  const defaultModel = args.defaultModel ?? OPENAI_DEFAULT_MODEL;

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${args.apiKey}`,
    "Content-Type": "application/json",
  });

  return {
    name: providerName,
    displayHost,
    baseUrl,
    defaultModel,

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
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          models: [],
          rawHeaders: res.headers,
          errorMessage: extractErrorMessage(res.text),
        };
      }
      const body = res.json<{ data?: { id: string }[] }>();
      const models = (body?.data ?? [])
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter(Boolean);
      return { ok: true, status: res.status, models, rawHeaders: res.headers };
    },

    async chat(opts: ChatOptions): Promise<ChatResult> {
      const payload = {
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature ?? 0,
      };
      const res = await httpRequest(joinUrl(baseUrl, "chat/completions"), {
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
          errorMessage: extractErrorMessage(res.text),
          errorCode: extractErrorCode(res.text),
        };
      }
      const body = res.json<{
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      }>();
      const text = body?.choices?.[0]?.message?.content ?? "";
      return {
        ok: true,
        status: res.status,
        text,
        promptTokens: body?.usage?.prompt_tokens,
        completionTokens: body?.usage?.completion_tokens,
        totalTokens: body?.usage?.total_tokens,
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

function extractErrorMessage(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed?.error === "string") return parsed.error;
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    /* fall through */
  }
  return text.slice(0, 200);
}

function extractErrorCode(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; type?: string } };
    return parsed?.error?.code ?? parsed?.error?.type ?? undefined;
  } catch {
    return undefined;
  }
}
