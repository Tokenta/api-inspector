# API Inspector

> **Built by [Tokenta](https://tokenta.space)** — Open-source toolkit for verifying LLM API providers.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E=20-3c873a.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#roadmap)

Detect model identity mismatches, rate-limit discrepancies, quota anomalies, and performance claims of any OpenAI / Anthropic / Gemini / OpenAI-compatible LLM endpoint — in under a minute, from your terminal, with zero runtime dependencies.

---

## Why API Inspector

Most developers no longer buy AI access from official providers. They buy from resellers, marketplaces, Discord sellers, Telegram channels, generic API hubs, or "OpenAI-compatible" gateways. A typical purchase looks like this:

| Seller claims | Reality (often) |
| --- | --- |
| `gpt-4o` | Routed to **Kimi K2** or **DeepSeek-V3** behind a translation prompt |
| 100 RPM | 10 RPM in practice; 429s after the third request |
| 128K context | Hard fails above 32K |
| $100 of credit | $0.12 left on a shared account |
| Stable model | Silently swapped between providers per-request |

There is currently no easy way for buyers to **independently verify** any of this. API Inspector is that tool.

It runs the same kind of verification pipeline Tokenta uses internally to grade listings on its trusted-API marketplace, packaged as a standalone CLI you can run against any endpoint you control or are evaluating.

---

## Features

- **Model identity fingerprinting** — multi-prompt vendor detection that flags the most common model swaps (GPT to Kimi, Claude to DeepSeek, Gemini to Qwen, etc.).
- **Authentication and quota probe** — confirms the key is live and surfaces remaining-quota signals where providers expose them.
- **Model discovery vs claim** — compares the seller's claimed model name to what the endpoint actually advertises.
- **Effective context window probe** — sends canary tokens at increasing prompt sizes (1K → 32K by default, up to 128K with `--full-context`).
- **Latency benchmark** — p50 and p95 over a configurable burst.
- **Rate-limit transparency check** — inspects standard `x-ratelimit-*` headers for resold-endpoint stripping.
- **Explainable trust score** — every contribution to the 0–100 score is tied to a specific check; no opaque ML.
- **Provider plug-ins** — built-in clients for OpenAI, Anthropic, Google Gemini, plus any OpenAI-compatible custom endpoint.
- **CI-friendly** — `--json` flag emits a machine-readable report for build pipelines and audits.
- **Zero runtime dependencies** — ships only the TypeScript compiler and `@types/node` as dev deps.

---

## Install

### Run with `npx` (no install)

```bash
npx @tokenta/api-inspector verify
```

Or run the latest from GitHub directly:

```bash
npx github:Tokenta/api-inspector verify
```

### Global install

```bash
npm install -g @tokenta/api-inspector
api-inspector verify
```

### From source

```bash
git clone https://github.com/Tokenta/api-inspector.git
cd api-inspector
npm install
npm run build
node dist/cli.js verify
```

Requires Node.js 20 or newer.

---

## Usage

### Interactive

```bash
api-inspector verify
```

```
Tokenta Inspector
Independent verification for any LLM API provider.

Select provider:
  1. OpenAI                 (api.openai.com)
  2. Anthropic              (api.anthropic.com)
  3. Google Gemini          (generativelanguage.googleapis.com)
  4. Custom (OpenAI-compat) (your reseller / gateway)
> 1
Enter API key (input hidden):
> ********************
Claimed model (optional, e.g. gpt-4o):
> gpt-4o
```

### Non-interactive

```bash
api-inspector verify \
  --provider openai \
  --key "$OPENAI_API_KEY" \
  --claimed gpt-4o
```

### Audit a reseller / gateway

```bash
api-inspector verify \
  --provider custom \
  --base-url https://gateway.example.com/v1 \
  --key "sk-..." \
  --claimed gpt-4o
```

### CI-friendly JSON

```bash
api-inspector verify --provider openai --key "$KEY" --json > report.json
```

### All options

| Flag | Description |
| --- | --- |
| `--provider <name>` | `openai` \| `anthropic` \| `gemini` \| `custom` |
| `--key <api-key>` | API key (or set `API_INSPECTOR_KEY`) |
| `--claimed <model>` | Model name advertised by the seller |
| `--base-url <url>` | Override base URL (required for `custom`) |
| `--quick` | Skip context-window probe |
| `--full-context` | Probe up to 128K context |
| `--latency-samples <n>` | Latency probe sample count (default 5) |
| `--timeout <ms>` | Per-request timeout (default 30000) |
| `--json` | Emit JSON instead of a TTY report |
| `--no-color` | Disable ANSI color output |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

---

## Sample output

```
API Inspector Report
Tool        v0.1.0    Started   2026-06-07T01:42:11Z

Provider    api.openai.com
Base URL    https://api.openai.com/v1
Claimed     gpt-4o
Detected    OpenAI (gpt) (confidence 100%)
Context     32K observed
Latency     p50 412 ms  p95 780 ms
Rate limit  10000 req/min (header reported)

Pipeline
  [OK]  Endpoint reachability       api.openai.com responded with HTTP 401
  [OK]  Authentication              Key accepted by api.openai.com
  [OK]  Model discovery             gpt-4o is advertised (catalog: 67 models)
  [OK]  Latency benchmark           p50 412 ms, p95 780 ms (5/5 successful)
  [OK]  Context window probe        Confirmed at 32K tokens
  [OK]  Fingerprint analysis        Detected OpenAI (confidence 100%) - consistent with claimed "gpt-4o"
  [OK]  Rate-limit headers          6 rate-limit headers exposed

  Trust score: 95 / 100   [VERIFIED]

Built by Tokenta - https://tokenta.space
Source:           https://github.com/Tokenta/api-inspector
```

A failing audit looks like this:

```
Pipeline
  [OK]  Endpoint reachability       gateway.example.com responded with HTTP 200
  [OK]  Authentication              Key accepted by gateway.example.com
  [!!]  Model discovery             "gpt-4o" is NOT advertised by this endpoint (3 models listed)
  [OK]  Latency benchmark           p50 1840 ms, p95 5420 ms (5/5 successful)
  [!!]  Context window probe        Confirmed at 4K tokens
  [XX]  Fingerprint analysis        Detected DeepSeek (confidence 100%) but seller claimed "gpt-4o". Likely model swap.
  [!!]  Rate-limit headers          No standard rate-limit headers exposed (transparency concern on resold endpoints)

  Trust score: 28 / 100   [HIGH RISK]
```

---

## Pipeline

1. **Endpoint reachability** — TLS handshake, host responds.
2. **Authentication** — `GET /models` (or equivalent) with the supplied key.
3. **Model discovery** — compare advertised models to the seller's claim. Grades: `exact`, `family`, `absent`.
4. **Latency benchmark** — N small chat requests, p50 / p95 of round-trip latency.
5. **Context window probe** — canary tokens at 1K → 32K (`--full-context` extends to 128K).
6. **Fingerprint analysis** — multi-prompt vendor identification with confidence and claim-mismatch flagging.
7. **Rate-limit transparency** — inspects standard `x-ratelimit-*` headers.
8. **Trust score** — explainable additive aggregation across the seven checks.

See `src/scoring.ts` for the exact weights — the math is meant to be auditable, not a black box.

---

## Development

```bash
git clone https://github.com/Tokenta/api-inspector.git
cd api-inspector
npm install
npm run build
node dist/cli.js verify
```

Project layout:

```
src/
  cli.ts                  CLI entry, arg parsing, interactive prompts
  pipeline.ts             Orchestrates checks in order
  scoring.ts              Trust score weighting (auditable, no ML)
  report.ts               TTY report renderer
  types.ts                Shared types and interfaces
  providers/              OpenAI / Anthropic / Gemini / Custom clients
  checks/                 Reachability, auth+discovery, latency, context,
                          fingerprint, rate-limit
  util/                   ANSI colors, fetch wrapper, args, prompt
```

Pull requests are welcome. Promising contribution areas:

- New provider plug-ins (Mistral, Together, Groq, Bedrock, Vertex, Cohere).
- Additional fingerprint heuristics (tokenizer behavior, knowledge-cutoff probes, deterministic-trap prompts).
- Streaming verification mode.
- Cryptographic proof receipts for tamper-evident audit trails.

---

## Roadmap

- [ ] Streaming verification mode (`--stream`)
- [ ] Provider plug-ins: Mistral, Together, Groq, Bedrock, Vertex, Cohere
- [ ] Burst-test mode for true rate-limit measurement
- [ ] Tokenizer-divergence fingerprint
- [ ] Cryptographic proof receipts (tamper-evident)
- [ ] `pip install api-inspector` (Python wrapper)
- [ ] Homebrew formula

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Need a verified AI marketplace?

API Inspector is part of the **[Tokenta](https://tokenta.space)** open-source ecosystem:

- **api-inspector** — this repo. Verify any LLM endpoint from your terminal.
- **model-fingerprints** — public dataset of vendor signatures (coming soon).
- **provider-benchmark** — reproducible benchmarks across providers (coming soon).
- **tokenta-platform** — the trusted AI API marketplace (in beta).

Sellers on Tokenta are continuously verified using the same pipeline that ships in this CLI. If you are tired of model swaps, ghost quotas, and ratelimit lies, follow the project on GitHub and **stay tuned for Tokenta — coming soon.**

> Powered by the Tokenta Verification Engine.
