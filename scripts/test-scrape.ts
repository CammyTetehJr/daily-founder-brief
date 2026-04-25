import { getDb, type Competitor } from "../lib/db";
import { diffLatestTwo } from "../lib/diff";
import { scrapeAndStore } from "../lib/tavily";

async function main() {
  const competitor = getDb()
    .prepare(`SELECT * FROM competitors WHERE name = ?`)
    .get("Grammarly") as Competitor | undefined;

  if (!competitor) throw new Error("Run `npm run seed` first.");
  if (!competitor.pricing_page) throw new Error("Grammarly has no pricing_page");

  console.log(`Scraping ${competitor.pricing_page} (pass 1)...`);
  const s1 = await scrapeAndStore({
    competitorId: competitor.id,
    sourceType: "pricing",
    url: competitor.pricing_page,
  });
  console.log(`  ${s1.raw_content.length} chars, hash ${s1.content_hash.slice(0, 12)}`);

  console.log(`Scraping ${competitor.pricing_page} (pass 2)...`);
  const s2 = await scrapeAndStore({
    competitorId: competitor.id,
    sourceType: "pricing",
    url: competitor.pricing_page,
  });
  console.log(`  ${s2.raw_content.length} chars, hash ${s2.content_hash.slice(0, 12)}`);

  const diff = diffLatestTwo({
    competitorId: competitor.id,
    sourceType: "pricing",
  });

  if (!diff) {
    console.log("\nNo diff (less than 2 scrapes stored)");
    return;
  }

  console.log(`\nDiff: changed=${diff.changed}`);
  if (diff.changed) {
    console.log(`  + ${diff.addedLines.length} lines`);
    console.log(`  - ${diff.removedLines.length} lines`);
    if (diff.addedLines.length) {
      console.log("\nSample added:");
      for (const l of diff.addedLines.slice(0, 5)) console.log(`  + ${l}`);
    }
  } else {
    console.log("  (content identical)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
