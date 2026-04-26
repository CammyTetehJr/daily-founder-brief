import { diffLines } from "diff";
import { getDb, type Scrape, type SourceType } from "./db";

export type ScrapeDiff = {
  before: Scrape;
  after: Scrape;
  addedLines: string[];
  removedLines: string[];
  changed: boolean;
};

/**
 * Pure-function diff of two scrapes.
 *
 * Caller is responsible for fetching and ordering the scrapes; this function
 * just compares them. `rows` is expected in DESC-by-extracted_at order
 * (newest first), matching how `diffLatestTwo` queries the DB.
 *
 * Returns null if fewer than 2 scrapes are provided. If the two scrapes have
 * the same content_hash, returns a diff with `changed: false` and empty
 * line arrays. Otherwise computes the line-level diff.
 */
export function diffScrapes(rows: Scrape[]): ScrapeDiff | null {
  if (rows.length < 2) return null;

  const [after, before] = rows;

  if (after.content_hash === before.content_hash) {
    return { before, after, addedLines: [], removedLines: [], changed: false };
  }

  const chunks = diffLines(before.raw_content, after.raw_content);
  const addedLines: string[] = [];
  const removedLines: string[] = [];

  for (const chunk of chunks) {
    const lines = chunk.value.split("\n").filter((l) => l.trim().length > 0);
    if (chunk.added) addedLines.push(...lines);
    else if (chunk.removed) removedLines.push(...lines);
  }

  return { before, after, addedLines, removedLines, changed: true };
}

export function diffLatestTwo(params: {
  competitorId: string;
  sourceType: SourceType;
}): ScrapeDiff | null {
  const rows = getDb()
    .prepare(
      `SELECT * FROM scrapes
       WHERE competitor_id = ? AND source_type = ?
       ORDER BY extracted_at DESC
       LIMIT 2`,
    )
    .all(params.competitorId, params.sourceType) as Scrape[];

  return diffScrapes(rows);
}
