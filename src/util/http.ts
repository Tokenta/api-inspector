/**
 * Minimal fetch wrapper. We rely on Node 20+'s built-in fetch and AbortController
 * so we ship without `undici`, `node-fetch`, or `axios`.
 *
 * - Adds a hard timeout (default 30s).
 * - Always returns a structured object so callers can score on status.
 * - Captures all response headers (lowercased keys) for downstream rate-limit /
 *   fingerprint checks.
 */

import { performance } from "node:perf_hooks";

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
  json: <T = unknown>() => T | null;
  latencyMs: number;
  /** Set when the request failed before receiving a status (network / timeout). */
  errorMessage?: string;
  /** Tag for failure reason: "TIMEOUT", "NETWORK", or undefined on HTTP responses. */
  errorCode?: "TIMEOUT" | "NETWORK";
}

export async function httpRequest(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      text,
      json: <T,>() => {
        try {
          return JSON.parse(text) as T;
        } catch {
          return null;
        }
      },
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    const aborted = e?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      statusText: aborted ? "TIMEOUT" : "NETWORK_ERROR",
      headers: {},
      text: "",
      json: () => null,
      latencyMs: Math.round(performance.now() - t0),
      errorMessage: aborted ? `Request timed out after ${timeoutMs}ms` : e?.message ?? "network error",
      errorCode: aborted ? "TIMEOUT" : "NETWORK",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}
