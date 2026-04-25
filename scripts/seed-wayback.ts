import { createHash, randomUUID } from "node:crypto";

import { getDb, type Competitor, type SourceType } from "../lib/db";

type WaybackResponse = {
  archived_snapshots?: {
    closest?: {
      available?: boolean;
      url?: string;
      timestamp?: string;
    };
  };
};

// Cascade of target timestamps - try closest first, fall back to older snapshots.
// 90d, 180d, 365d, then any available (empty string = nearest to now).
const TARGET_TIMESTAMPS = [
  "20260124", // ~90 days ago
  "20251024", // ~6 months ago
  "20250424", // ~1 year ago
  "", // no constraint - closest to now
];

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!TAVILY_API_KEY) {
  console.error("TAVILY_API_KEY is not set");
  process.exit(1);
}

async function fetchWithRetry(endpoint: string, maxAttempts = 3): Promise<Response | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(endpoint);
    if (res.ok) return res;
    if (res.status === 503 || res.status === 429) {
      const delay = 2000 * attempt;
      console.log(`    (HTTP ${res.status}, retrying in ${delay}ms)`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res; // non-retryable
  }
  return null;
}

async function resolveSnapshot(url: string): Promise<
  | { ok: true; archiveUrl: string; snapshotTimestamp: string }
  | { ok: false; reason: string }
> {
  for (const ts of TARGET_TIMESTAMPS) {
    const endpoint = ts
      ? `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${ts}`
      : `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const res = await fetchWithRetry(endpoint);
    if (!res) continue;
    if (!res.ok) continue;
    const data = (await res.json()) as WaybackResponse;
    const closest = data.archived_snapshots?.closest;
    if (closest?.available && closest.url && closest.timestamp) {
      const archiveUrl = closest.url.replace(/\/web\/(\d+)\//, "/web/$1id_/");
      return { ok: true, archiveUrl, snapshotTimestamp: closest.timestamp };
    }
    // pause before trying next timestamp
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: false, reason: "no snapshot at any tried timestamp" };
}

async function extractMarkdown(archiveUrl: string): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      urls: [archiveUrl],
      format: "markdown",
      extract_depth: "advanced",
    }),
  });
  if (!res.ok) {
    console.error(`  tavily extract HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json()) as {
    results?: Array<{ raw_content?: string }>;
    failed_results?: Array<{ url: string; error: string }>;
  };
  return data.results?.[0]?.raw_content ?? null;
}

function waybackTimestampToIso(ts: string): string {
  // YYYYMMDDHHMMSS -> ISO
  const y = ts.slice(0, 4);
  const m = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const hh = ts.slice(8, 10) || "00";
  const mm = ts.slice(10, 12) || "00";
  const ss = ts.slice(12, 14) || "00";
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
}

type SeedTarget = {
  competitor: Competitor;
  sourceType: SourceType;
  url: string;
};

function targets(competitors: Competitor[]): SeedTarget[] {
  const out: SeedTarget[] = [];
  for (const c of competitors) {
    if (c.pricing_page)
      out.push({ competitor: c, sourceType: "pricing", url: c.pricing_page });
    if (c.careers_page)
      out.push({ competitor: c, sourceType: "careers", url: c.careers_page });
    if (c.website)
      out.push({ competitor: c, sourceType: "homepage", url: c.website });
  }
  return out;
}

async function main() {
  const db = getDb();
  const competitors = db
    .prepare(`SELECT * FROM competitors ORDER BY name`)
    .all() as Competitor[];
  if (competitors.length === 0) {
    console.error("No competitors. Run `npm run seed` first.");
    process.exit(1);
  }

  const allTargets = targets(competitors);
  console.log(
    `Seeding Wayback baselines for ${competitors.length} competitors, ${allTargets.length} URLs`,
  );
  console.log(`Timestamp cascade: ${TARGET_TIMESTAMPS.map((t) => t || "any").join(" -> ")}\n`);

  // Only treat scrapes older than 30 days as existing baselines.
  // Anything newer is a live/test scrape, not a Wayback seed.
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 3600 * 1000,
  ).toISOString();
  const existsStmt = db.prepare(
    `SELECT id FROM scrapes WHERE competitor_id = ? AND source_type = ? AND extracted_at < ? LIMIT 1`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO scrapes (id, competitor_id, source_type, url, content_hash, raw_content, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const report = { ok: 0, skipped: 0, failed: 0 };

  for (const t of allTargets) {
    const label = `${t.competitor.name}/${t.sourceType}`;
    process.stdout.write(`${label}\n  ${t.url}\n`);

    const existing = existsStmt.get(
      t.competitor.id,
      t.sourceType,
      thirtyDaysAgo,
    ) as { id: string } | undefined;
    if (existing) {
      console.log(`  ~ baseline already exists; skipping\n`);
      report.skipped++;
      continue;
    }

    const snap = await resolveSnapshot(t.url);
    if (!snap.ok) {
      console.log(`  x ${snap.reason}\n`);
      report.failed++;
      continue;
    }
    console.log(`  -> snapshot ${snap.snapshotTimestamp}`);

    const content = await extractMarkdown(snap.archiveUrl);
    if (!content) {
      console.log(`  x extract failed\n`);
      report.failed++;
      continue;
    }

    const hash = createHash("sha256").update(content).digest("hex");
    insertStmt.run(
      randomUUID(),
      t.competitor.id,
      t.sourceType,
      t.url,
      hash,
      content,
      waybackTimestampToIso(snap.snapshotTimestamp),
    );
    console.log(`  + stored ${content.length} chars, hash ${hash.slice(0, 12)}\n`);
    report.ok++;

    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(
    `\nDone. ok=${report.ok} skipped=${report.skipped} failed=${report.failed}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
