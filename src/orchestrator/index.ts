import { OrchestratorOutput } from "../types.js";
import { TraceCollector } from "../trace/collector.js";
import { SnippetStore } from "../retrieval/store.js";
import { planQuery } from "./planner.js";
import { executePlan } from "./executor.js";
import { synthesize } from "./synthesizer.js";
import { progressBus } from "../utils/progress.js";
import { detectConflicts } from "../retrieval/conflict.js";
import { StepPlan } from "../types.js";

export interface OrchestratorOptions {
  topK?: number;
}

export async function orchestrate(
  query: string,
  options: OrchestratorOptions = {}
): Promise<OrchestratorOutput> {
  const { topK = 5 } = options;

  const trace = new TraceCollector(query);
  const store = new SnippetStore();

  // 1. Planning steps
  progressBus.publish({ type: "step:start", stepId: "planner", description: "Planning steps..." });
  let plan: StepPlan[];
  try {
    plan = await planQuery(query);
  } catch (err) {
    progressBus.publish({
      type: "step:info",
      stepId: "planner",
      message: `Planner error, using fallback: ${(err as Error).message}`,
    });
    plan = buildFallbackPlan(query);
  }

  trace.setPlan(plan);
  progressBus.publish({ type: "plan", data: plan, message: `Plan ready - ${plan.length} steps` });

  // 2. Executing steps
  await executePlan(plan, store, trace);

  // 3. Ranking passages
  progressBus.publish({ type: "rank", message: `Ranking top-${topK} passages (BM25)...` });
  const ranked = store.rankAndSelect(query, topK);
  const snippetsRetrieved = store.size();
  const snippetsUsed = ranked.length;

  trace.info("rank_snippets", `Selected ${snippetsUsed} of ${snippetsRetrieved} passages`, {
    selected: ranked.map((s) => ({ id: s.id, url: s.url, score: s.relevanceScore })),
  });

  // 4. Checking for conflicts
  let conflictCaveat: string | undefined;
  if (ranked.length >= 2) {
    progressBus.publish({ type: "step:start", stepId: "conflict_check", stepType: "check", description: "Checking for source conflicts..." });
    const conflict = await detectConflicts(query, ranked);
    if (conflict.hasConflict && conflict.description) {
      conflictCaveat = `Conflicting sources detected: ${conflict.description}`;
      trace.info("conflict_check", `Conflict found: ${conflict.description}`);
      progressBus.publish({ type: "step:done", stepId: "conflict_check", stepType: "check", description: "Conflict detected", durationMs: 0 });
    } else {
      progressBus.publish({ type: "step:done", stepId: "conflict_check", stepType: "check", description: "No conflicts found", durationMs: 0 });
    }
  }

  // 5. Synthesizing answer
  progressBus.publish({ type: "synthesize:start", message: "Synthesizing answer..." });
  const result = await synthesize(query, ranked, trace.build(snippetsRetrieved, snippetsUsed), conflictCaveat);
  const finalTrace = trace.build(snippetsRetrieved, snippetsUsed);
  const output: OrchestratorOutput = { ...result, trace: finalTrace };

  progressBus.publish({ type: "synthesize:done", data: output });
  return output;
}

function buildFallbackPlan(query: string): StepPlan[] {
  return [
    { id: "search_main", type: "search", description: `Search for: ${query}`, dependsOn: [], params: { query } },
    { id: "fetch_results", type: "fetch", description: "Fetch top search result pages", dependsOn: ["search_main"], params: { sourceStepId: "search_main", maxUrls: 4 } },
    { id: "rank_snippets", type: "rank", description: "Rank retrieved snippets by relevance", dependsOn: ["fetch_results"], params: { topK: 5, dependsOn: ["fetch_results"] } },
    { id: "synthesize", type: "synthesize", description: "Synthesize grounded answer from snippets", dependsOn: ["rank_snippets"], params: {} },
  ];
}