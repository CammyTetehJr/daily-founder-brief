import { getDb, type Competitor } from "../lib/db";
import { analyzeScreenshot } from "../lib/gemini";
import { takeScreenshot } from "../lib/screenshot";

const VISUAL_PROMPT = `You are inspecting a screenshot of a competitor's web page for a competitive intelligence brief.

Extract a tight, factual readout. Use this exact structure:

PAGE TYPE: <one of: pricing | careers | homepage | other>
HEADLINE: <verbatim hero / H1 text, with quotes>
SUBHEAD: <verbatim subheadline if present, else "none">
PRICING TIERS: <if visible: list each tier as "TIER_NAME — price/period — top 2-3 features". If not visible: "none on this view".>
PROMINENT CTAS: <list of button/link copy that's most visually emphasized, max 3>
ANNOUNCEMENTS / BANNERS: <any time-limited banners, launch callouts, "new" badges; else "none">
NOTABLE VISUAL ELEMENTS: <one sentence on layout, color emphasis, hero imagery>
SHIPPED FEATURES MENTIONED: <bullet list of named product features if any>

Be ruthless about accuracy. If something isn't visible in the image, say so. Do not invent prices, tier names, or features.`;

async function main() {
  const target = process.argv[2] ?? "Jasper";
  const sourceType = process.argv[3] ?? "pricing";
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

  console.log(`competitor: ${target}`);
  console.log(`source:     ${sourceType}`);
  console.log(`url:        ${url}\n`);

  const t0 = Date.now();
  console.log("[1/2] taking screenshot...");
  const shot = await takeScreenshot({
    url,
    competitorId: competitor.id,
    sourceType,
  });
  console.log(`      ${Math.round(shot.bytes / 1024)} KB, ${shot.viewport}`);
  console.log(`      saved: ${shot.path}`);

  console.log("\n[2/2] sending to Gemini...");
  const analysis = await analyzeScreenshot({
    imageBuffer: shot.buffer,
    prompt: VISUAL_PROMPT,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`      ${analysis.length} chars in ${elapsed}s\n`);
  console.log("--- ANALYSIS ---");
  console.log(analysis);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
