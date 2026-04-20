import axios from "axios";
import * as cheerio from "cheerio";

const TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 4000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; research-bot/1.0; +https://github.com/example/llm-orchestrator)";

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  ok: boolean;
  error?: string;
}

/**
 * Fetches a URL and returns cleaned plain text content.
 * Silently trims content beyond MAX_CONTENT_CHARS.
 */
export async function fetchPage(url: string): Promise<FetchedPage> {
  try {
    const res = await axios.get<string>(url, {
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      maxRedirects: 5,
      // Reject obviously non-HTML responses early
      validateStatus: (s) => s < 400,
    });

    const contentType = String(res.headers["content-type"] ?? "");
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { url, title: "", content: "", ok: false, error: "Non-HTML content type" };
    }

    const $ = cheerio.load(res.data);

    // Remove noise elements
    $(
      "script, style, nav, footer, header, aside, .ad, .ads, .advertisement, .cookie-banner, [aria-hidden='true']"
    ).remove();

    const title = $("title").first().text().trim() || $("h1").first().text().trim();

    // Prefer article/main content areas
    const contentEl =
      $("article").first().text() ||
      $("main").first().text() ||
      $("body").text();

    const content = cleanText(contentEl).slice(0, MAX_CONTENT_CHARS);

    if (!content) {
      return { url, title, content: "", ok: false, error: "No usable text content" };
    }

    return { url, title, content, ok: true };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return { url, title: "", content: "", ok: false, error: msg };
  }
}

function cleanText(raw: string): string {
  return raw
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
