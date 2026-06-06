/**
 * Terminal report renderer.
 *
 * Output is plain text + ANSI colors so it pipes cleanly to less / tee / log
 * collectors. The trust score gets a prominent banner because it is the
 * single thing most users will look at.
 */

import type { InspectionReport } from "./types.js";
import { c, statusBadge } from "./util/colors.js";

export function renderReport(report: InspectionReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(c.bold("API Inspector Report"));
  lines.push(
    `${c.dim("Tool")}        ${"v" + report.toolVersion}    ` +
      `${c.dim("Started")}   ${report.startedAt}`,
  );
  lines.push("");
  lines.push(`${c.dim("Provider")}    ${report.displayHost}`);
  lines.push(`${c.dim("Base URL")}    ${report.baseUrl}`);
  if (report.claimedModel) {
    lines.push(`${c.dim("Claimed")}     ${report.claimedModel}`);
  }
  if (report.detectedModel) {
    const conf = report.detectedConfidence != null ? ` (confidence ${report.detectedConfidence}%)` : "";
    lines.push(`${c.dim("Detected")}    ${report.detectedModel}${conf}`);
  }
  if (report.contextWindowObserved != null) {
    lines.push(`${c.dim("Context")}     ${formatTokens(report.contextWindowObserved)} observed`);
  }
  if (report.latencyP50Ms != null && report.latencyP95Ms != null) {
    lines.push(
      `${c.dim("Latency")}     ` +
        `p50 ${report.latencyP50Ms} ms  p95 ${report.latencyP95Ms} ms`,
    );
  }
  if (report.rateLimitHeader) {
    lines.push(`${c.dim("Rate limit")}  ${report.rateLimitHeader}`);
  }
  if (report.fingerprintNote) {
    lines.push(`${c.dim("Note")}        ${c.yellow(report.fingerprintNote)}`);
  }

  lines.push("");
  lines.push(c.bold("Pipeline"));
  for (const check of report.checks) {
    const badge = statusBadge(check.status);
    const dur = check.durationMs != null ? c.gray(` (${check.durationMs} ms)`) : "";
    lines.push(`  ${badge}  ${pad(check.label, 26)} ${check.detail ?? ""}${dur}`);
  }

  lines.push("");
  lines.push(verdictBanner(report));
  lines.push("");
  lines.push(c.dim("Built by Tokenta - https://tokenta.space"));
  lines.push(c.dim("Source:           https://github.com/Tokenta/api-inspector"));
  lines.push("");

  return lines.join("\n");
}

function verdictBanner(report: InspectionReport): string {
  const score = report.trustScore;
  const text = `Trust score: ${score} / 100   [${report.verdict.replace("_", " ")}]`;
  const padded = "  " + text + "  ";
  if (report.verdict === "VERIFIED") return c.bgGreen(c.bold(padded));
  if (report.verdict === "SUSPECT") return c.bgYellow(c.bold(padded));
  return c.bgRed(c.bold(padded));
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + " ".repeat(width - text.length);
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
