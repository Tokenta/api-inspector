/**
 * Google Gemini provider client (Generative Language API v1beta).
 *
 * Auth: API key passed via `x-goog-api-key` header (preferred) or `?key=` query
 * (fallback). We use the header form so the key never lands in URL access logs.
 *
 * Endpoints used:
 *   GET  /v1beta/models                            — list models
 *   POST /v1beta/models/{model}:generateContent    — chat
 */

import { httpRequest, joinUrl } from "../util/http.js";
import type {
  ChatOptions,
  ChatResult,
  ModelListResult,
  ProviderClient,
} from "../types.js";

const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_DEFAULT_MODEL = "gemini-1.5-flash";

interface GeminiArgs {
  apiKey: string;
  baseUrl?: string;
}

export function createGeminiClient(args: GeminiArgs): ProviderClient {
  const baseUrl = (args.baseUrl ?? GEMINI_DEFAULT_BASE).replace(/\/+$/, "");
  const displayHost = hostFromUrl(baseUrl) ?? "generativelanguage.googleapis.com";

  const authHeaders = (): Record<string, string> => ({
    "x-goog-api-key": args.apiKey,
    "Content-Type": "application/json",
  });

  return {
    name: "gemini",
    displayHost,
    baseUrl,
    defaultModel: GEMINI_DEFAULT_MODEL,

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
          errorMessage: extractGeminiError(res.text),
        };
      }
      const body = res.json<{ models?: { name?: string }[] }>();
      const models = (body?.models ?? [])
        .map((m) => stripModelsPrefix(m.name ?? ""))
        .filter(Boolean);
      return { ok: true, status: res.status, models, rawHeaders: res.headers };
    },

    async chat(opts: ChatOptions): Promise<ChatResult> {
      // Gemini collapses system + user messages into `contents`. We map roles:
      //   role "system"    -> systemInstruction
      //   role "user"      -> contents[].role = "user"
      //   role "assistant" -> contents[].role = "model"
      const system = opts.messages.find((m) => m.role === "system")?.content;
      const contents = opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
      const payload: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0,
          maxOutputTokens: opts.maxTokens ?? 256,
        },
      };
      if (system) {
        payload.systemInstruction = { parts: [{ text: system }] };
      }

      const url = joinUrl(baseUrl, `models/${encodeURIComponent(opts.model)}:generateContent`);
      const res = await httpRequest(url, {
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
          errorMessage: extractGeminiError(res.text),
          errorCode: extractGeminiErrorStatus(res.text),
        };
      }
      const body = res.json<{
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }>();
      const text =
        body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return {
        ok: true,
        status: res.status,
        text,
        promptTokens: body?.usageMetadata?.promptTokenCount,
        completionTokens: body?.usageMetadata?.candidatesTokenCount,
        totalTokens: body?.usageMetadata?.totalTokenCount,
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

function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function extractGeminiError(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    /* fall through */
  }
  return text ? text.slice(0, 200) : undefined;
}

function extractGeminiErrorStatus(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { status?: string } };
    return parsed?.error?.status;
  } catch {
    return undefined;
  }
}
