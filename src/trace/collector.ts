import { TraceEvent, OrchestratorTrace, StepPlan, StepResult } from "../types.js";

export class TraceCollector {
  private events: TraceEvent[] = [];
  private plan: StepPlan[] = [];
  private results: StepResult[] = [];
  private query: string;
  private startedAt: string;

  constructor(query: string) {
    this.query = query;
    this.startedAt = new Date().toISOString();
  }

  setPlan(plan: StepPlan[]): void {
    this.plan = plan;
    this.log("orchestrator", "info", `Plan created with ${plan.length} steps`, {
      steps: plan.map((s) => ({ id: s.id, type: s.type, description: s.description })),
    });
  }

  stepStart(stepId: string, message?: string): void {
    this.log(stepId, "start", message ?? `Step started`);
  }

  stepEnd(stepId: string, result: StepResult, message?: string): void {
    this.results.push(result);
    this.log(stepId, "end", message ?? `Step completed in ${result.durationMs}ms`, {
      status: result.status,
      durationMs: result.durationMs,
    });
  }

  stepError(stepId: string, error: string): void {
    this.log(stepId, "error", error);
  }

  info(stepId: string, message: string, data?: unknown): void {
    this.log(stepId, "info", message, data);
  }

  private log(stepId: string, event: TraceEvent["event"], message: string, data?: unknown): void {
    this.events.push({
      ts: new Date().toISOString(),
      stepId,
      event,
      message,
      data,
    });
  }

  build(snippetsRetrieved: number, snippetsUsed: number): OrchestratorTrace {
    return {
      query: this.query,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      plan: this.plan,
      results: this.results,
      events: this.events,
      snippetsRetrieved,
      snippetsUsed,
    };
  }

  // Pretty-print a compact trace summary for terminal output
  static format(trace: OrchestratorTrace): string {
    const lines: string[] = [];
    const sep = "─".repeat(60);

    lines.push(`\n${sep}`);
    lines.push(`  TRACE  ·  ${trace.query}`);
    lines.push(sep);

    const totalMs =
      trace.finishedAt
        ? new Date(trace.finishedAt).getTime() - new Date(trace.startedAt).getTime()
        : 0;

    lines.push(`  Duration  : ${totalMs}ms`);
    lines.push(`  Snippets  : ${trace.snippetsRetrieved} retrieved → ${trace.snippetsUsed} used`);
    lines.push(`  Steps     : ${trace.results.length}/${trace.plan.length}`);
    lines.push("");

    for (const step of trace.plan) {
      const result = trace.results.find((r) => r.stepId === step.id);
      const status = result?.status ?? "pending";
      const icon =
        status === "done" ? "✓" :
        status === "failed" ? "✗" :
        status === "skipped" ? "–" : "?";
      const dur = result ? ` (${result.durationMs}ms)` : "";
      lines.push(`  ${icon} [${step.type.padEnd(10)}] ${step.description}${dur}`);
      if (result?.error) {
        lines.push(`      ⚠  ${result.error}`);
      }
    }

    lines.push(sep);
    return lines.join("\n");
  }
}
