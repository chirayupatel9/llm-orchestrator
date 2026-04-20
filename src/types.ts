// Core domain types

export interface RetrievedSnippet {
  id: string;
  url: string;
  title: string;
  content: string;
  relevanceScore: number; // 0–1, set after ranking
  retrievedAt: string;
}

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

// Orchestration types

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepPlan {
  id: string;
  type: "search" | "fetch" | "rank" | "synthesize";
  description: string;
  dependsOn: string[]; // ids of steps that must complete first
  params: Record<string, unknown>;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  durationMs: number;
  output?: unknown;
  error?: string;
}

// Trace types

export interface TraceEvent {
  ts: string; // ISO timestamp
  stepId: string;
  event: "start" | "end" | "error" | "info";
  message: string;
  data?: unknown;
}

export interface OrchestratorTrace {
  query: string;
  startedAt: string;
  finishedAt?: string;
  plan: StepPlan[];
  results: StepResult[];
  events: TraceEvent[];
  snippetsRetrieved: number;
  snippetsUsed: number;
}

// Final output

export interface Citation {
  index: number;
  url: string;
  title: string;
  relevanceScore: number;
}

export interface OrchestratorOutput {
  query: string;
  answer: string;
  citations: Citation[];
  confidence: "high" | "medium" | "low" | "insufficient";
  caveat?: string;
  trace: OrchestratorTrace;
}
