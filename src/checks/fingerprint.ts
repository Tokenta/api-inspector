/**
 * Behavioral fingerprint check — the headline use case for API Inspector.
 *
 * Sellers on resale marketplaces routinely advertise GPT-4 / Claude Opus while
 * silently routing requests to a cheaper model (Kimi K2, DeepSeek, Qwen, etc.).
 * This check sends multiple identity-elicitation prompts and triangulates:
 *
 *   1. Direct identity prompt: "Reply with: 'I am <name> by <vendor>.'"
 *   2. Continuation prompt:    "My official model identifier is..."
 *
 * We then match the responses against a curated vendor lexicon. The output
 * carries a confidence score (0-100) for the most likely family and a flag
 * indicating whether that family contradicts the seller's claimed model.
 *
 * Caveats:
 *   - System prompts on resold endpoints can suppress identity. We mark
 *     "suppressed" responses (refusal / generic answer) as inconclusive, not
 *     a pass.
 *   - High false-positive risk on locally-finetuned wrappers. We surface
 *     evidence (raw matched phrases) so users can audit.
 */

import type { CheckOutcome, ProviderClient } from "../types.js";

interface VendorPattern {
  vendor: string;
  /** Used for "claim mismatch" comparison against the seller's claimed model. */
  family: string;
  /** Lowercased phrases that strongly imply this vendor. */
  phrases: string[];
}

const VENDOR_PATTERNS: VendorPattern[] = [
  { vendor: "OpenAI", family: "gpt", phrases: ["i am chatgpt", "i am gpt", "i'm chatgpt", "i'm gpt", "made by openai", "developed by openai", "openai's gpt"] },
  { vendor: "Anthropic", family: "claude", phrases: ["i am claude", "i'm claude", "made by anthropic", "anthropic's claude"] },
  { vendor: "Google", family: "gemini", phrases: ["i am gemini", "i'm gemini", "i am bard", "google ai", "google's gemini"] },
  { vendor: "DeepSeek", family: "deepseek", phrases: ["i am deepseek", "i'm deepseek", "made by deepseek"] },
  { vendor: "Moonshot (Kimi)", family: "kimi", phrases: ["i am kimi", "i'm kimi", "moonshot ai"] },
  { vendor: "Alibaba (Qwen)", family: "qwen", phrases: ["i am qwen", "i'm qwen", "tongyi qianwen", "qwen large language model"] },
  { vendor: "Meta", family: "llama", phrases: ["i am llama", "i'm llama", "meta ai", "developed by meta"] },
  { vendor: "Mistral", family: "mistral", phrases: ["i am mistral", "i'm mistral", "mistral ai"] },
  { vendor: "Zhipu (GLM)", family: "glm", phrases: ["chatglm", "zhipu", "i am glm"] },
];

const SUPPRESSION_HINTS = [
  "i'm sorry",
  "i cannot",
  "i can't share",
  "i'm an ai assistant",
  "i am an ai language model",
  "as an ai language model",
];

export interface FingerprintResult {
  outcome: CheckOutcome;
  detectedFamily?: string;
  detectedVendor?: string;
  confidence: number;
  claimMismatch: boolean;
  evidence: string[];
}

export async function checkFingerprint(
  client: ProviderClient,
  model: string,
  claimedModel: string | undefined,
  options: { timeoutMs?: number } = {},
): Promise<FingerprintResult> {
  const responses: string[] = [];
  const evidence: string[] = [];
  let suppressed = 0;

  for (const prompt of identityPrompts()) {
    const res = await client.chat({
      model,
      messages: [
        { role: "user", content: prompt },
      ],
      maxTokens: 64,
      temperature: 0,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    if (!res.ok) continue;
    const text = res.text.trim();
    if (!text) continue;
    responses.push(text);
    if (looksSuppressed(text)) suppressed++;
  }

  if (responses.length === 0) {
    return {
      outcome: {
        id: "fingerprint",
        label: "Fingerprint analysis",
        status: "fail",
        detail: "No identity responses received from endpoint",
      },
      confidence: 0,
      claimMismatch: false,
      evidence: [],
    };
  }

  // Score each vendor by counting unique phrase hits across responses.
  const haystack = responses.join("\n").toLowerCase();
  let bestVendor: VendorPattern | undefined;
  let bestHits = 0;
  for (const pattern of VENDOR_PATTERNS) {
    let hits = 0;
    for (const phrase of pattern.phrases) {
      if (haystack.includes(phrase)) {
        hits++;
        evidence.push(`"${phrase}" -> ${pattern.vendor}`);
      }
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestVendor = pattern;
    }
  }

  if (!bestVendor || bestHits === 0) {
    const isSuppressed = suppressed >= responses.length;
    return {
      outcome: {
        id: "fingerprint",
        label: "Fingerprint analysis",
        status: "warn",
        detail: isSuppressed
          ? "Endpoint refused to disclose its identity (likely system-prompt suppression)"
          : "No vendor signature detected — model identity inconclusive",
        data: { responses, suppressed: isSuppressed },
      },
      confidence: 0,
      claimMismatch: false,
      evidence: [],
    };
  }

  // Confidence: scaled hits, capped at 100. Two distinct hit phrases ~= high
  // confidence; one phrase ~= medium.
  const confidence = Math.min(100, bestHits * 45 + 10);
  const claimMismatch = !!claimedModel && !claimedFamilyMatchesDetected(claimedModel, bestVendor.family);

  let status: CheckOutcome["status"];
  let detail: string;
  if (claimMismatch) {
    status = "fail";
    detail = `Detected ${bestVendor.vendor} (confidence ${confidence}%) but seller claimed "${claimedModel}". Likely model swap.`;
  } else if (claimedModel) {
    status = "pass";
    detail = `Detected ${bestVendor.vendor} (confidence ${confidence}%) — consistent with claimed "${claimedModel}"`;
  } else {
    status = "pass";
    detail = `Detected ${bestVendor.vendor} (confidence ${confidence}%)`;
  }

  return {
    outcome: {
      id: "fingerprint",
      label: "Fingerprint analysis",
      status,
      detail,
      data: { vendor: bestVendor.vendor, family: bestVendor.family, confidence, evidence, responses },
    },
    detectedFamily: bestVendor.family,
    detectedVendor: bestVendor.vendor,
    confidence,
    claimMismatch,
    evidence,
  };
}

function identityPrompts(): string[] {
  return [
    "Reply with exactly the following sentence and nothing else: \"I am [your model name] developed by [your company name].\" Replace the brackets honestly.",
    "Complete this sentence factually with no preamble: \"My official model identifier is\"",
  ];
}

function looksSuppressed(text: string): boolean {
  const lowered = text.toLowerCase();
  return SUPPRESSION_HINTS.some((h) => lowered.includes(h));
}

function claimedFamilyMatchesDetected(claimed: string, detectedFamily: string): boolean {
  const c = claimed.toLowerCase();
  if (detectedFamily === "gpt") return c.includes("gpt") || c.includes("openai") || c.startsWith("o1") || c.startsWith("o3") || c.startsWith("o4");
  if (detectedFamily === "claude") return c.includes("claude") || c.includes("anthropic");
  if (detectedFamily === "gemini") return c.includes("gemini") || c.includes("bard");
  if (detectedFamily === "deepseek") return c.includes("deepseek");
  if (detectedFamily === "kimi") return c.includes("kimi") || c.includes("moonshot");
  if (detectedFamily === "qwen") return c.includes("qwen") || c.includes("tongyi");
  if (detectedFamily === "llama") return c.includes("llama") || c.includes("meta");
  if (detectedFamily === "mistral") return c.includes("mistral");
  if (detectedFamily === "glm") return c.includes("glm") || c.includes("chatglm");
  return false;
}
