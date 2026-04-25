import Anthropic from "@anthropic-ai/sdk";
import { getDb, type Signal } from "./db";

const MODEL = process.env.COMPOSE_MODEL ?? "claude-sonnet-4-6";

export type SignalWithCompetitor = Signal & { competitor_name: string };

export type SignalBullet = {
  competitor: string;
  signal_type: string;
  one_liner: string;
  receipt: string;
  confidence: number;
};

export type ComposedBrief = {
  subject_line: string;
  headline: string;
  threat_level: number;
  opening: string;
  signal_bullets: SignalBullet[];
  what_it_means: string;
  actions: string[];
};

export function getRecentSignals(
  userId: string,
  hoursBack = 24,
): SignalWithCompetitor[] {
  const cutoff = new Date(Date.now() - hoursBack * 3_600_000).toISOString();
  return getDb()
    .prepare(
      `SELECT s.*, c.name as competitor_name
       FROM signals s
       JOIN competitors c ON s.competitor_id = c.id
       WHERE c.user_id = ? AND s.detected_at >= ?
       ORDER BY s.confidence DESC, s.detected_at DESC`,
    )
    .all(userId, cutoff) as SignalWithCompetitor[];
}

const SYSTEM_PROMPT = `You are composing a morning competitive intelligence brief for the founder of ToneSwap, an AI writing/tone product competing with Grammarly, QuillBot, Wordtune, and similar.

Given signals detected overnight, produce a structured brief the founder reads over coffee. Tone: founder to founder. Direct. No corporate fluff. No hedging.

Return ONLY valid JSON with this exact shape:
{
  "subject_line": "string, specific not generic, no emoji clutter",
  "headline": "string, one line describing what's happening",
  "threat_level": number from 1-10,
  "opening": "2-3 sentences, direct hook",
  "signal_bullets": [
    {
      "competitor": "string",
      "signal_type": "string",
      "one_liner": "one sentence with specific detail",
      "receipt": "source URL or the literal string 'scrape diff'",
      "confidence": number from 0.0 to 1.0
    }
  ],
  "what_it_means": "2-3 sentences, market/strategic interpretation",
  "actions": ["2 to 4 imperative action items for today"]
}

Rules:
- If zero signals, still return valid JSON. Set threat_level 1-3, empty signal_bullets array, honest opening ("Quiet overnight. No meaningful moves from tracked competitors."), what_it_means noting the status quo, one or two default actions (continue planned priorities, re-check in 24h).
- Never invent signals, numbers, or URLs. Only reference what the input provides.
- Every non-empty signal_bullet must preserve the receipt from the input unchanged.
- Keep copy tight. Founder has 30 seconds.
- Never use em dashes (—) or en dashes (–). Use a hyphen, a comma, a period, or break into two sentences. This is non-negotiable.
- Never use emoji or any decorative icons in any field. No 🚨, 📊, ✅, ⚠️, 💡, ⭐, 🔍, 🎯, ✓, ✗, ★ etc. No "AI assistant" cliche markers like brackets such as [URGENT] or [CRITICAL]. Plain text founder-to-founder voice only. This rule supersedes any temptation to add visual emphasis.
- Subject lines, headlines, and bullet text must read like a real human founder wrote them. No Twitter-thread or marketing-copy energy.`;

function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ");
}

// Strip emoji and decorative icons that the model occasionally inserts despite
// being explicitly told not to. Range covers: emoji presentation, dingbats,
// supplemental symbols, regional indicators, variation selectors, and the
// common geometric/checkmark glyphs we've seen leak through.
const ICON_RE =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu;

function stripIcons(s: string): string {
  return s.replace(ICON_RE, "").replace(/\s{2,}/g, " ").trim();
}

function clean(s: string): string {
  return stripIcons(stripDashes(s));
}

function sanitize(brief: ComposedBrief): ComposedBrief {
  return {
    ...brief,
    subject_line: clean(brief.subject_line),
    headline: clean(brief.headline),
    opening: clean(brief.opening),
    what_it_means: clean(brief.what_it_means),
    signal_bullets: brief.signal_bullets.map((b) => ({
      ...b,
      one_liner: clean(b.one_liner),
    })),
    actions: brief.actions.map(clean),
  };
}

export async function composeBrief(params: {
  signals: SignalWithCompetitor[];
}): Promise<ComposedBrief> {
  const client = new Anthropic();

  const signalInput = params.signals.map((s, i) => ({
    i: i + 1,
    competitor: s.competitor_name,
    signal_type: s.signal_type,
    summary: s.summary,
    confidence: s.confidence,
    receipt: s.source_url ?? (s.after_scrape_id ? "scrape diff" : "no receipt"),
  }));

  const userMessage = `Signals detected (${params.signals.length} total):\n\n${JSON.stringify(signalInput, null, 2)}\n\nCompose the brief. Return ONLY the JSON object, no prose around it.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error(
      `compose: no JSON object found in model response: ${text.slice(0, 300)}`,
    );
  }

  const parsed = JSON.parse(text.slice(start, end + 1)) as ComposedBrief;
  return sanitize(parsed);
}
