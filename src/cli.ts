#!/usr/bin/env node
/**
 * API Inspector CLI entry point.
 *
 * Goals (intentional, in order of priority):
 *   1. Zero runtime dependencies — fast install for first-time users.
 *   2. Useful even in --json mode so it can run in CI.
 *   3. Deterministic exit codes:
 *        0 = inspection completed (regardless of trust score)
 *        1 = invalid arguments
 *        2 = network / unrecoverable execution failure
 *
 * Built by Tokenta. Open source under MIT.
 */

import { parseArgs, flagString, flagBool, flagNumber } from "./util/args.js";
import { ask, askChoice, askSecret } from "./util/prompt.js";
import { c, isColorEnabled, setColorEnabled } from "./util/colors.js";
import { runInspection } from "./pipeline.js";
import { renderReport } from "./report.js";
import type { ProviderConfig, ProviderName } from "./types.js";

const TOOL_VERSION = "0.1.0";

const HELP = `${c.bold("api-inspector")} ${c.dim("v" + TOOL_VERSION)}
Open-source toolkit for verifying LLM API providers. Built by Tokenta.

${c.bold("USAGE")}
  api-inspector verify [options]
  api-inspector --help
  api-inspector --version

${c.bold("OPTIONS")}
  --provider <name>      openai | anthropic | gemini | custom
  --key <api-key>        API key (or set API_INSPECTOR_KEY env var)
  --claimed <model>      Model name claimed by the seller (e.g. gpt-4o)
  --base-url <url>       Override base URL (required for "custom"; optional otherwise)
  --quick                Skip context-window probe (faster, fewer tokens)
  --full-context         Probe up to 128K context window (uses more tokens)
  --latency-samples <n>  Latency probe sample count (default 5)
  --timeout <ms>         Per-request timeout in milliseconds (default 30000)
  --json                 Emit machine-readable JSON instead of a TTY report
  --no-color             Disable ANSI color output
  -h, --help             Show this help
  -v, --version          Show version

${c.bold("EXAMPLES")}
  api-inspector verify
  api-inspector verify --provider openai --key sk-... --claimed gpt-4o
  api-inspector verify --provider custom --base-url https://gateway.example.com/v1 --key sk-...
  api-inspector verify --provider openai --key $OPENAI_API_KEY --json > report.json

${c.bold("LEARN MORE")}
  Repository: https://github.com/Tokenta/api-inspector
  Tokenta:    https://tokenta.space
`;

function fail(message: string): never {
  process.stderr.write(c.red("error: ") + message + "\n");
  process.exit(1);
}

function isProviderName(value: string): value is ProviderName {
  return value === "openai" || value === "anthropic" || value === "gemini" || value === "custom";
}

async function gatherInteractiveConfig(): Promise<ProviderConfig> {
  if (isColorEnabled()) {
    process.stdout.write(c.bold("Tokenta Inspector") + "\n");
  } else {
    process.stdout.write("Tokenta Inspector\n");
  }
  process.stdout.write(c.dim("Independent verification for any LLM API provider.\n\n"));

  const provider = await askChoice<ProviderName>("Select provider:", [
    { value: "openai", label: "OpenAI                 (api.openai.com)" },
    { value: "anthropic", label: "Anthropic              (api.anthropic.com)" },
    { value: "gemini", label: "Google Gemini          (generativelanguage.googleapis.com)" },
    { value: "custom", label: "Custom (OpenAI-compat) (your reseller / gateway)" },
  ]);

  let baseUrl: string | undefined;
  if (provider === "custom") {
    const raw = await ask("Custom base URL (e.g. https://gateway.example.com/v1):\n> ");
    if (!raw) fail("custom provider requires --base-url");
    baseUrl = raw;
  } else {
    const raw = await ask(c.dim("Optional base URL override (press Enter to skip):\n> "));
    baseUrl = raw || undefined;
  }

  const apiKey = await askSecret("Enter API key (input hidden):\n> ");
  if (!apiKey) fail("API key is required");

  const claimed = await ask(c.dim("Claimed model (optional, e.g. gpt-4o):\n> "));

  return {
    provider,
    apiKey,
    baseUrl,
    claimedModel: claimed || undefined,
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.flags.version) {
    process.stdout.write(`api-inspector ${TOOL_VERSION}\n`);
    return;
  }
  if (parsed.flags.help || (parsed.command == null && process.stdin.isTTY !== true)) {
    process.stdout.write(HELP);
    return;
  }
  if (flagBool(parsed.flags, "no-color")) {
    setColorEnabled(false);
  }

  const cmd = parsed.command ?? "verify";
  if (cmd !== "verify") {
    process.stderr.write(c.red("error: ") + `unknown command "${cmd}"\n\n`);
    process.stdout.write(HELP);
    process.exit(1);
  }

  let config: ProviderConfig;

  const providerFlag = flagString(parsed.flags, "provider");
  const keyFlag = flagString(parsed.flags, "key") ?? process.env.API_INSPECTOR_KEY;
  const baseUrlFlag = flagString(parsed.flags, "base-url");
  const claimedFlag = flagString(parsed.flags, "claimed");

  if (providerFlag != null && keyFlag != null) {
    if (!isProviderName(providerFlag)) {
      fail(`unknown provider "${providerFlag}". Use openai, anthropic, gemini, or custom.`);
    }
    if (providerFlag === "custom" && !baseUrlFlag) {
      fail(`--provider custom requires --base-url`);
    }
    config = {
      provider: providerFlag,
      apiKey: keyFlag,
      baseUrl: baseUrlFlag,
      claimedModel: claimedFlag,
    };
  } else if (providerFlag != null && keyFlag == null) {
    fail("--key is required when --provider is supplied (or set API_INSPECTOR_KEY).");
  } else {
    config = await gatherInteractiveConfig();
  }

  const json = flagBool(parsed.flags, "json");
  const quick = flagBool(parsed.flags, "quick");
  const fullContext = flagBool(parsed.flags, "full-context");
  const latencySamples = flagNumber(parsed.flags, "latency-samples") ?? 5;
  const timeoutMs = flagNumber(parsed.flags, "timeout") ?? 30_000;

  const report = await runInspection(config, {
    quick,
    fullContext,
    latencySamples,
    timeoutMs,
    toolVersion: TOOL_VERSION,
  });

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderReport(report));
  }
}

main().catch((err: unknown) => {
  const e = err as { message?: string; stack?: string };
  process.stderr.write(c.red("fatal: ") + (e?.message ?? "unknown error") + "\n");
  if (process.env.API_INSPECTOR_DEBUG) {
    process.stderr.write((e?.stack ?? "") + "\n");
  }
  process.exit(2);
});
