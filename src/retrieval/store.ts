import { RetrievedSnippet } from "../types.js";
import crypto from "crypto";

/**
 * Snippet store with BM25 ranking and passage chunking.
 *
 * Instead of storing one blob per page, each fetched page is split into
 * overlapping ~400-char passages. BM25 (Robertson et al.) is used for
 * ranking instead of raw TF-IDF, it handles term saturation and document
 * length normalisation, which matters a lot when passages vary in size.
 *
 * BM25 formula:
 *   score(q,d) = Σ IDF(t) * (tf * (k1+1)) / (tf + k1*(1 - b + b*|d|/avgdl))
 *   k1=1.5, b=0.75 (standard Robertson defaults)
 */

const CHUNK_SIZE    = 400;  // chars per passage
const CHUNK_OVERLAP = 80;   // overlap between consecutive passages
const BM25_K1       = 1.5;
const BM25_B        = 0.75;

export class SnippetStore {
  private snippets: Map<string, RetrievedSnippet> = new Map();

  /**
   * Add a page, splits content into overlapping passages, stores each one.
   * Returns the number of passages added.
   */
  add(url: string, title: string, content: string): number {
    const passages = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
    let added = 0;
    passages.forEach((passage, idx) => {
      const id = crypto
        .createHash("md5")
        .update(`${url}::${idx}`)
        .digest("hex")
        .slice(0, 10);
      this.snippets.set(id, {
        id,
        url,
        title,
        content: passage,
        relevanceScore: 0,
        retrievedAt: new Date().toISOString(),
      });
      added++;
    });
    return added;
  }

  size(): number {
    return this.snippets.size;
  }

  all(): RetrievedSnippet[] {
    return Array.from(this.snippets.values());
  }

 
  rankAndSelect(query: string, k = 5): RetrievedSnippet[] {
    const docs = Array.from(this.snippets.values());
    if (docs.length === 0) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return dedupeByUrl(docs).slice(0, k);

    // Corpus stats for BM25
    const avgdl = docs.reduce((s, d) => s + tokenize(d.content).length, 0) / docs.length;
    const idf   = computeIdf(queryTerms, docs);

    const scored = docs.map((doc) => {
      const docTerms = tokenize(doc.content + " " + doc.title);
      const score    = bm25Score(queryTerms, docTerms, idf, avgdl);
      return { ...doc, relevanceScore: parseFloat(score.toFixed(4)) };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Write scores back
    scored.forEach((s) => this.snippets.set(s.id, s));

    // Deduplicate: keep only the best passage per URL, then take top-k
    return dedupeByUrl(scored).slice(0, k);
  }
}

// BM25

function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  idf: Map<string, number>,
  avgdl: number
): number {
  const dl = docTerms.length;
  const termFreq = new Map<string, number>();
  for (const t of docTerms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const tf  = termFreq.get(term) ?? 0;
    if (tf === 0) continue;
    const idfVal   = idf.get(term) ?? 0;
    const numerator   = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
    score += idfVal * (numerator / denominator);
  }
  return score;
}

function computeIdf(
  queryTerms: string[],
  docs: RetrievedSnippet[]
): Map<string, number> {
  const N   = docs.length;
  const idf = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const df = docs.filter((d) =>
      (d.content + " " + d.title).toLowerCase().includes(term)
    ).length;
    // Robertson IDF with smoothing
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

// Chunking

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  // Split on paragraph / sentence boundaries where possible
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 20);

  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length > size && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep the tail of the last chunk
      current = current.slice(Math.max(0, current.length - overlap)) + " " + para;
    } else {
      current += (current ? " " : "") + para;
    }
  }
  if (current.trim().length > 40) chunks.push(current.trim());

  // If no paragraphs, fall back to sliding window over raw chars
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += size - overlap) {
      chunks.push(text.slice(i, i + size));
      if (i + size >= text.length) break;
    }
  }

  return chunks.length > 0 ? chunks : [text.slice(0, size)];
}

// Helpers

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function dedupeByUrl(snippets: RetrievedSnippet[]): RetrievedSnippet[] {
  const seen = new Set<string>();
  return snippets.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

// Common English stopwords — removing them improves BM25 precision
const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","this","that","these","those","is","are","was","were","be",
  "been","being","have","has","had","do","does","did","will","would","could",
  "should","may","might","can","its","it","as","not","also","more","than",
  "about","which","when","where","who","how","what","their","they","them",
]);