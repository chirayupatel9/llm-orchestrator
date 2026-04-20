import axios from "axios";
import { IncomingMessage } from "http";

const BASE_URL = "https://api.minimax.io/v1";
const MODEL = process.env.LLM_MODEL ?? "MiniMax-Text-01";

function getApiKey(): string {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    throw new Error(
      "MINIMAX_API_KEY environment variable is not set. " +
        "Copy .env.example to .env and fill in your key."
    );
  }
  return key;
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

interface MinimaxMessage {
  role: string;
  name?: string;
  content: string;
}

interface MinimaxResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  base_resp?: { status_code: number; status_msg: string };
  input_sensitive?: boolean;
  output_sensitive?: boolean;
}

interface MinimaxStreamChunk {
  choices: Array<{
    delta?: { content?: string };
    finish_reason?: string;
  }>;
  base_resp?: { status_code: number; status_msg: string };
}

function buildMessages(system: string, messages: LLMMessage[]): MinimaxMessage[] {
  return [
    { role: "system", name: "MiniMax AI", content: system },
    ...messages.map((m) => ({
      role: m.role,
      name: m.role === "user" ? "User" : "MiniMax AI",
      content: m.content,
    })),
  ];
}

// Non-streaming (used by planner, conflict detector)

export async function llmComplete(
  system: string,
  messages: LLMMessage[],
  maxTokens = 2048
): Promise<string> {
  const apiKey = getApiKey();

  let data: MinimaxResponse;
  try {
    const res = await axios.post<MinimaxResponse>(
      `${BASE_URL}/text/chatcompletion_v2`,
      { model: MODEL, messages: buildMessages(system, messages), max_completion_tokens: maxTokens },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 60_000,
      }
    );
    data = res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      throw new Error(`MiniMax API error ${err.response?.status}: ${JSON.stringify(err.response?.data ?? {})}`);
    }
    throw err;
  }

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax error ${data.base_resp.status_code}: ${data.base_resp.status_msg}`);
  }
  if (data.input_sensitive) throw new Error("MiniMax flagged the input as sensitive content.");

  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error("MiniMax returned no content in choices");
  return choice.message.content;
}

// Streaming (used by synthesizer)

// Streaming (used by synthesizer)
// Calls MiniMax with stream:true and yields tokens as they arrive.
// Also returns the full completed text at the end via the return value.
export async function* llmStream(
  system: string,
  messages: LLMMessage[],
  maxTokens = 2048
): AsyncGenerator<string, string, unknown> {
  const apiKey = getApiKey();

  const res = await axios.post(
    `${BASE_URL}/text/chatcompletion_v2`,
    {
      model: MODEL,
      messages: buildMessages(system, messages),
      max_completion_tokens: maxTokens,
      stream: true,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      responseType: "stream",
      timeout: 60_000,
    }
  );

  const stream = res.data as IncomingMessage;
  let full = "";
  let buf = "";

  for await (const chunk of stream) {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return full;

      let parsed: MinimaxStreamChunk;
      try { parsed = JSON.parse(raw); } catch { continue; }

      if (parsed.base_resp && parsed.base_resp.status_code !== 0) {
        throw new Error(`MiniMax stream error ${parsed.base_resp.status_code}: ${parsed.base_resp.status_msg}`);
      }

      const token = parsed.choices?.[0]?.delta?.content ?? "";
      if (token) {
        full += token;
        yield token;
      }
    }
  }

  return full;
}