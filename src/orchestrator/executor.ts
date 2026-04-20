import { StepPlan, StepResult, StepStatus } from "../types.js";
import { TraceCollector } from "../trace/collector.js";
import { SnippetStore } from "../retrieval/store.js";
import { searchDuckDuckGo } from "../tools/search.js";
import { fetchPage } from "../tools/fetch.js";
import { SearchResult } from "../types.js";
import { progressBus } from "../utils/progress.js";

type StepOutputMap = Map<string, unknown>;

export async function executePlan(
  plan: StepPlan[],
  store: SnippetStore,
  trace: TraceCollector
): Promise<StepOutputMap> {
  const outputs: StepOutputMap = new Map();
  const statuses = new Map<string, StepStatus>(plan.map((s) => [s.id, "pending"]));

  const maxPasses = plan.length + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const ready = plan.filter(
      (s) =>
        statuses.get(s.id) === "pending" &&
        (s.dependsOn ?? []).every((dep) => {
          const st = statuses.get(dep);
          return st === "done" || st === "skipped";
        })
    );

    if (ready.length === 0) break;

    await Promise.all(
      ready.map(async (step) => {
        statuses.set(step.id, "running");
        trace.stepStart(step.id, step.description);
        progressBus.publish({ type: "step:start", stepId: step.id, stepType: step.type, description: step.description });
        const t0 = Date.now();

        try {
          const output = await runStep(step, outputs, store, trace);
          outputs.set(step.id, output);
          statuses.set(step.id, "done");

          const durationMs = Date.now() - t0;
          const result: StepResult = { stepId: step.id, status: "done", durationMs, output };
          trace.stepEnd(step.id, result);
          progressBus.publish({ type: "step:done", stepId: step.id, stepType: step.type, description: step.description, durationMs });
        } catch (err) {
          const error = (err as Error).message ?? String(err);
          statuses.set(step.id, "failed");
          trace.stepError(step.id, error);

          const durationMs = Date.now() - t0;
          const result: StepResult = { stepId: step.id, status: "failed", durationMs, error };
          trace.stepEnd(step.id, result, `Step failed: ${error}`);
          progressBus.publish({ type: "step:fail", stepId: step.id, stepType: step.type, description: step.description, durationMs, message: error });

          cascadeSkip(step.id, plan, statuses);
        }
      })
    );
  }

  for (const [id, st] of statuses) {
    if (st === "pending") {
      statuses.set(id, "skipped");
      const result: StepResult = { stepId: id, status: "skipped", durationMs: 0 };
      trace.stepEnd(id, result, "Skipped (dependency failed)");
    }
  }

  return outputs;
}

async function runStep(
  step: StepPlan,
  outputs: StepOutputMap,
  store: SnippetStore,
  trace: TraceCollector
): Promise<unknown> {
  switch (step.type) {
    case "search": {
      const query = (step.params.query as string) ?? "";
      trace.info(step.id, `Searching: "${query}"`);
      const results = await searchDuckDuckGo(query, 8);
      trace.info(step.id, `Found ${results.length} results`);
      return results;
    }

    case "fetch": {
      const sourceId = step.params.sourceStepId as string;
      const maxUrls = (step.params.maxUrls as number) ?? 3;
      const searchResults = (outputs.get(sourceId) as SearchResult[]) ?? [];

      const urlsToFetch = searchResults.slice(0, maxUrls).map((r) => r.url);
      trace.info(step.id, `Fetching ${urlsToFetch.length} URLs`);

      const pages = await Promise.all(urlsToFetch.map((url) => fetchPage(url)));

      let pagesAdded = 0;
      let passagesAdded = 0;
      for (const page of pages) {
        if (page.ok && page.content.length > 100) {
          const passages = store.add(page.url, page.title, page.content);
          pagesAdded++;
          passagesAdded += passages;
        } else if (!page.ok) {
          trace.info(step.id, `Skipped ${page.url}: ${page.error}`);
        }
      }

      trace.info(step.id, `Added ${pagesAdded} pages → ${passagesAdded} passages (store size: ${store.size()})`);
      return { fetched: urlsToFetch.length, pagesAdded, passagesAdded };
    }

    case "rank": {
      const topK = (step.params.topK as number) ?? 5;
      trace.info(step.id, `Will select top-${topK} snippets at synthesis time`);
      return { topK };
    }

    case "synthesize": {
      return { ready: true };
    }

    default: {
      throw new Error(`Unknown step type: ${(step as StepPlan).type}`);
    }
  }
}

function cascadeSkip(
  failedId: string,
  plan: StepPlan[],
  statuses: Map<string, StepStatus>
): void {
  for (const step of plan) {
    if (
      statuses.get(step.id) === "pending" &&
      (step.dependsOn ?? []).includes(failedId)
    ) {
      statuses.set(step.id, "skipped");
      cascadeSkip(step.id, plan, statuses);
    }
  }
}