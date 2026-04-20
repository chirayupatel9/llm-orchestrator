import { OrchestratorOutput } from "../types.js";
import { TraceCollector } from "../trace/collector.js";

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "\x1b[32m",         // green
  medium: "\x1b[33m",       // yellow
  low: "\x1b[31m",          // red
  insufficient: "\x1b[35m", // magenta
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

export function formatOutput(output: OrchestratorOutput, opts: { json?: boolean; noTrace?: boolean } = {}): string {
  if (opts.json) {
    return JSON.stringify(output, null, 2);
  }

  const lines: string[] = [];
  const { answer, citations, confidence, caveat, query, trace } = output;
  const confColor = CONFIDENCE_COLOR[confidence] ?? "";

  lines.push("");
  lines.push(`${BOLD}Answer${RESET}`);
  lines.push(`${DIM}Query: ${query}${RESET}`);
  lines.push(`${DIM}Confidence: ${confColor}${confidence.toUpperCase()}${RESET}`);

  if (caveat) {
    lines.push(`${DIM}⚠  ${caveat}${RESET}`);
  }

  lines.push("");
  lines.push(answer);
  lines.push("");

  if (citations.length > 0) {
    lines.push(`${BOLD}Sources${RESET}`);
    for (const c of citations) {
      lines.push(`  [${c.index}] ${c.title}`);
      lines.push(`      ${DIM}${c.url}${RESET}`);
      lines.push(`      ${DIM}relevance: ${c.relevanceScore.toFixed(3)}${RESET}`);
    }
    lines.push("");
  }

  if (!opts.noTrace) {
    lines.push(TraceCollector.format(trace));
  }

  return lines.join("\n");
}
