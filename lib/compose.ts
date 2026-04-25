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
- Never use em dashes (—) or en dashes (–). Use a hyphen, a comma, a period, or break into two sentences. This is non-negotiable.`;

function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ");
}

function sanitize(brief: ComposedBrief): ComposedBrief {
  return {
    ...brief,
    subject_line: stripDashes(brief.subject_line),
    headline: stripDashes(brief.headline),
    opening: stripDashes(brief.opening),
    what_it_means: stripDashes(brief.what_it_means),
    signal_bullets: brief.signal_bullets.map((b) => ({
      ...b,
      one_liner: stripDashes(b.one_liner),
    })),
    actions: brief.actions.map(stripDashes),
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
