import { RetrievedSnippet, OrchestratorOutput, Citation } from "../types.js";
import { llmStream } from "../utils/llm.js";
import { progressBus } from "../utils/progress.js";
import { OrchestratorTrace } from "../types.js";

const SYNTH_SYSTEM = `You are a research analyst producing a grounded, factual answer.

You will be given:
1. A user query
2. A numbered list of source snippets retrieved from the web

Your task:
- Answer the query using ONLY the information in the provided snippets.
- Cite sources using [N] notation where N is the snippet number.
- Be concise but complete. Use prose, not bullet lists unless truly appropriate.
- If snippets are insufficient, contradictory, or of low quality, say so explicitly.
- NEVER invent facts. If you cannot answer from the snippets, say "Insufficient information found."

At the end of your answer, output a JSON block (and nothing else after it) in this exact format:
<meta>
{
  "confidence": "high" | "medium" | "low" | "insufficient",
  "caveat": "optional string explaining any limitations or conflicts"
}
</meta>`;

export async function synthesize(
  query: string,
  snippets: RetrievedSnippet[],
  trace: OrchestratorTrace,
  conflictCaveat?: string
): Promise<Omit<OrchestratorOutput, "trace">> {
  if (snippets.length === 0) {
    return {
      query,
      answer: "No usable sources were retrieved. This may be due to network errors, blocked pages, or an overly specific query. Please try rephrasing your query.",
      citations: [],
      confidence: "insufficient",
      caveat: "No snippets were available for synthesis.",
    };
  }

  const context = snippets
    .map((s, i) => `[${i + 1}] Source: ${s.title}\nURL: ${s.url}\nRelevance: ${s.relevanceScore.toFixed(3)}\n\n${s.content}`)
    .join("\n\n" + "─".repeat(40) + "\n\n");

  const conflictNote = conflictCaveat
    ? `\n\nIMPORTANT: A conflict has been detected between sources: ${conflictCaveat}. Acknowledge this conflict explicitly in your answer and set confidence to "low".`
    : "";

  const userMessage = `Query: ${query}${conflictNote}\n\nSources:\n\n${context}`;

  // Stream tokens via progressBus so the server can forward them to the browser
  let rawAnswer = "";
  try {
    const gen = llmStream(SYNTH_SYSTEM, [{ role: "user", content: userMessage }], 2048);
    for await (const token of gen) {
      rawAnswer += token;
      // Emit each token — server forwards as SSE "token" event
      progressBus.publish({ type: "token", message: token });
    }
  } catch (err) {
    return {
      query,
      answer: "Synthesis failed due to an LLM error. Please retry.",
      citations: [],
      confidence: "insufficient",
      caveat: (err as Error).message,
    };
  }

  // Parse <meta> block from completed text
  const metaMatch = rawAnswer.match(/<meta>\s*([\s\S]*?)\s*<\/meta>/);
  let confidence: OrchestratorOutput["confidence"] = "medium";
  let caveat: string | undefined;

  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]) as {
        confidence?: OrchestratorOutput["confidence"];
        caveat?: string;
      };
      confidence = meta.confidence ?? "medium";
      caveat = meta.caveat;
    } catch {
      // keep defaults
    }
  }

  const answer = rawAnswer.replace(/<meta>[\s\S]*?<\/meta>/, "").trim();

  // Merge conflict caveat
  if (conflictCaveat && !caveat) {
    caveat = conflictCaveat;
    if (confidence === "high") confidence = "medium";
  } else if (conflictCaveat && caveat) {
    caveat = `${conflictCaveat}. ${caveat}`;
    if (confidence === "high") confidence = "medium";
  }

  const citations: Citation[] = snippets
    .map((s, i) => {
      const cited = answer.includes(`[${i + 1}]`);
      return cited ? { index: i + 1, url: s.url, title: s.title, relevanceScore: s.relevanceScore } : null;
    })
    .filter((c): c is Citation => c !== null);

  return { query, answer, citations, confidence, caveat };
}