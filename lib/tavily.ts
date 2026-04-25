import { tavily } from "@tavily/core";
import { createHash, randomUUID } from "node:crypto";
import { getDb, type Scrape, type SourceType } from "./db";

let _client: ReturnType<typeof tavily> | null = null;

function client() {
  if (!_client) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
    _client = tavily({ apiKey });
  }
  return _client;
}

export type ScrapeInput = {
  competitorId: string;
  sourceType: SourceType;
  url: string;
};

export async function scrapeAndStore(input: ScrapeInput): Promise<Scrape> {
  const response = await client().extract([input.url], {
    format: "markdown",
    extractDepth: "advanced",
  });

  const result = response.results[0];
  if (!result) {
    const failed = response.failedResults[0];
    throw new Error(
      `Tavily extract failed for ${input.url}: ${failed?.error ?? "unknown"}`,
    );
  }

  const content = result.rawContent;
  const hash = createHash("sha256").update(content).digest("hex");
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO scrapes (id, competitor_id, source_type, url, content_hash, raw_content)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.competitorId, input.sourceType, input.url, hash, content);

  return {
    id,
    competitor_id: input.competitorId,
    source_type: input.sourceType,
    url: input.url,
    content_hash: hash,
    raw_content: content,
    extracted_at: new Date().toISOString(),
  };
}

export type NewsSearchOptions = {
  timeRange?: "day" | "week" | "month";
  maxResults?: number;
};

export async function searchNews(query: string, options: NewsSearchOptions = {}) {
  return client().search(query, {
    topic: "news",
    timeRange: options.timeRange ?? "week",
    maxResults: options.maxResults ?? 5,
  });
}
