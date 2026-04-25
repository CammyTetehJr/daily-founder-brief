import { getDb, type Competitor, type Scrape } from "../lib/db";
import { diffLatestTwo } from "../lib/diff";
import { scrapeAndStore } from "../lib/tavily";

async function main() {
  const target = process.argv[2] ?? "Grammarly";
  const sourceType = (process.argv[3] ?? "pricing") as
    | "pricing"
    | "careers"
    | "homepage";

  const competitor = getDb()
    .prepare(`SELECT * FROM competitors WHERE name = ?`)
    .get(target) as Competitor | undefined;
  if (!competitor) throw new Error(`competitor ${target} not found`);

  const url =
    sourceType === "pricing"
      ? competitor.pricing_page
      : sourceType === "careers"
        ? competitor.careers_page
        : competitor.website;
  if (!url) throw new Error(`${target} has no ${sourceType} URL`);

  // Drop any scrape for this (competitor, source_type) from today so the
  // diff cleanly reflects "today vs. baseline" without duplicate-today noise.
  const today = new Date().toISOString().slice(0, 10);
  const deleted = getDb()
    .prepare(
      `DELETE FROM scrapes
       WHERE competitor_id = ? AND source_type = ?
       AND substr(extracted_at, 1, 10) = ?`,
    )
    .run(competitor.id, sourceType, today);
  if (deleted.changes > 0) {
    console.log(`(cleared ${deleted.changes} prior today-scrapes)`);
  }

  const priors = getDb()
    .prepare(
      `SELECT id, extracted_at, length(raw_content) as len FROM scrapes
       WHERE competitor_id = ? AND source_type = ?
       ORDER BY extracted_at DESC LIMIT 3`,
    )
    .all(competitor.id, sourceType) as Array<{
    id: string;
    extracted_at: string;
    len: number;
  }>;
  console.log(`existing scrapes for ${target}/${sourceType}:`);
  for (const p of priors) {
    console.log(`  ${p.extracted_at}  ${p.len} chars  ${p.id.slice(0, 8)}`);
  }
  if (priors.length === 0) {
    console.log("  (none)");
  }

  console.log(`\nscraping ${url} live...`);
  const fresh = await scrapeAndStore({
    competitorId: competitor.id,
    sourceType,
    url,
  });
  console.log(`  ${fresh.raw_content.length} chars, ${fresh.content_hash.slice(0, 12)}`);

  const diff = diffLatestTwo({
    competitorId: competitor.id,
    sourceType,
  });
  if (!diff) {
    console.log("\nno diff (less than 2 scrapes for this competitor/source)");
    return;
  }

  console.log(
    `\ndiff: changed=${diff.changed}  before=${diff.before.extracted_at}  after=${diff.after.extracted_at}`,
  );
  console.log(`  added: ${diff.addedLines.length} lines`);
  console.log(`  removed: ${diff.removedLines.length} lines`);

  if (diff.addedLines.length) {
    console.log(`\nfirst 8 added lines:`);
    for (const l of diff.addedLines.slice(0, 8)) console.log(`  + ${l}`);
  }
  if (diff.removedLines.length) {
    console.log(`\nfirst 8 removed lines:`);
    for (const l of diff.removedLines.slice(0, 8)) console.log(`  - ${l}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
