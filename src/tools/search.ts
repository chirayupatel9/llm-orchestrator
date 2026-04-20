import axios from "axios";
import { SearchResult } from "../types.js";

const SERPER_API_URL = "https://google.serper.dev/search";
const TIMEOUT_MS = 10000;

/**
 * Search via Serper.dev (Google results, no scraping).
 * Requires SERPER_API_KEY env var, get one free at https://serper.dev
 */
export async function searchDuckDuckGo(
  query: string,
  limit = 8
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SERPER_API_KEY is not set. Get a free key at https://serper.dev and add it to your .env"
    );
  }

  const res = await axios.post<SerperResponse>(
    SERPER_API_URL,
    { q: query, num: limit },
    {
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      timeout: TIMEOUT_MS,
    }
  );

  const organic = res.data.organic ?? [];

  return organic.slice(0, limit).map((r) => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet ?? "",
  }));
}

// Serper response types

interface SerperResponse {
  organic?: SerperResult[];
  searchParameters?: { q: string };
}

interface SerperResult {
  title: string;
  link: string;
  snippet?: string;
  position?: number;
}