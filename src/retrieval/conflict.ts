import { RetrievedSnippet } from "../types.js";
import { llmComplete } from "../utils/llm.js";

export interface ConflictResult {
  hasConflict: boolean;
  description?: string; 
}

/**
 * Checks the top-ranked snippets for factual contradictions.
 *
 * Strategy: ask the LLM to compare snippets pairwise on key factual claims.
 * We only check the top-5 to keep latency low — if there are conflicts they
 * almost always appear in the highest-scoring sources.
 *
 * Returns quickly (single LLM call, small prompt) — designed to add less than 2 seconds.
 */
export async function detectConflicts(
  query: string,
  snippets: RetrievedSnippet[]
): Promise<ConflictResult> {
  
  if (snippets.length < 2) return { hasConflict: false };

  const top = snippets.slice(0, 5);

  const context = top
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.content.slice(0, 600)}`)
    .join("\n\n---\n\n");

  const system = `You are a fact-checking assistant. Your only job is to detect direct factual contradictions between sources.

A contradiction is when two sources make OPPOSITE or INCOMPATIBLE specific claims about the same fact, for example:
- Source A says a library was released in 2022, Source B says 2023
- Source A says X is faster, Source B says Y is faster
- Source A recommends approach X, Source B explicitly says X does not work

Do NOT flag:
- Different levels of detail or emphasis
- One source having more information than another  
- Different opinions or recommendations that are not mutually exclusive
- Uncertainty or hedging language

Respond with ONLY a JSON object, nothing else:
{ "conflict": true/false, "description": "Source [N] says X while source [M] says Y" }
If no conflict, use: { "conflict": false }`;

  const userMsg = `Query: ${query}\n\nSources to check:\n\n${context}`;

  try {
    const raw = await llmComplete(system, [{ role: "user", content: userMsg }], 256);
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as { conflict: boolean; description?: string };
    return {
      hasConflict: parsed.conflict === true,
      description: parsed.description,
    };
  } catch {
    // If conflict detection fails, don't block synthesis, just skip it
    return { hasConflict: false };
  }
}