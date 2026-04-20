import { StepPlan } from "../types.js";
import { llmComplete } from "../utils/llm.js";

const PLANNER_SYSTEM = `You are a research planning assistant.
Given a user query, produce a JSON execution plan as an array of steps.

Each step must have:
- id: short snake_case string
- type: one of "search" | "fetch" | "rank" | "synthesize"
- description: one-line human description
- dependsOn: array of step ids that must finish first
- params: object with step-specific config

Rules:
- Always start with at least one "search" step.
- Use "fetch" steps to retrieve full content from promising URLs (max 5 fetches).
- Include exactly one "rank" step (id: "rank_snippets") after all fetch steps.
- End with exactly one "synthesize" step (id: "synthesize") that depends on rank_snippets.
- Search steps can run in parallel (empty dependsOn).
- Fetch steps must depend on the search that found the URL — use the search step id.
- Keep the plan to 8 - 12 steps maximum.

For "search" params include: { query: string }
For "fetch" params include: { sourceStepId: string, maxUrls: number }
For "rank" params include: { topK: number, dependsOn: string[] }
For "synthesize" params include: {}

Respond with ONLY a valid JSON array. No markdown, no explanation.`;

export async function planQuery(query: string): Promise<StepPlan[]> {
  const raw = await llmComplete(PLANNER_SYSTEM, [
    { role: "user", content: `Query: ${query}` },
  ]);

  let plan: StepPlan[];
  try {
    plan = JSON.parse(raw.replace(/```json|```/g, "").trim()) as StepPlan[];
  } catch {
    throw new Error(`Planner returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  validatePlan(plan);
  return plan;
}

function validatePlan(plan: StepPlan[]): void {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error("Plan must be a non-empty array");
  }

  const ids = new Set(plan.map((s) => s.id));

  for (const step of plan) {
    if (!step.id || !step.type || !step.description) {
      throw new Error(`Step missing required fields: ${JSON.stringify(step)}`);
    }
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
    }
  }

  const hasSynthesize = plan.some((s) => s.id === "synthesize");
  if (!hasSynthesize) {
    throw new Error('Plan must include a "synthesize" step');
  }
}
