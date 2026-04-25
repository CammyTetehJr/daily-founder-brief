import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getDb, type Competitor } from "./db";
import { diffLatestTwo } from "./diff";
import { scrapeAndStore, searchNews } from "./tavily";

const MODEL = process.env.AGENT_MODEL ?? "claude-opus-4-7";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | {
      type: "signal_recorded";
      competitor: string;
      signal_type: string;
      summary: string;
      confidence: number;
    }
  | { type: "done"; signals: number; duration_ms: number }
  | { type: "error"; message: string };

const tools: Anthropic.Tool[] = [
  {
    name: "list_competitors",
    description:
      "List all competitors being tracked for the current user. Returns id, name, website, pricing_page, careers_page.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scrape_page",
    description:
      "Scrape a competitor URL via Tavily and store it as a timestamped snapshot. Returns the new scrape_id, char count, and content hash prefix.",
    input_schema: {
      type: "object",
      properties: {
        competitor_id: { type: "string" },
        source_type: {
          type: "string",
          enum: ["homepage", "pricing", "careers", "news", "github"],
        },
        url: { type: "string" },
      },
      required: ["competitor_id", "source_type", "url"],
    },
  },
  {
    name: "diff_latest",
    description:
      "Diff the two most recent snapshots for a (competitor, source_type) pair. Returns before_scrape_id, after_scrape_id, and added/removed lines. Call after scrape_page to see what changed vs. the previous run.",
    input_schema: {
      type: "object",
      properties: {
        competitor_id: { type: "string" },
        source_type: {
          type: "string",
          enum: ["homepage", "pricing", "careers", "news", "github"],
        },
      },
      required: ["competitor_id", "source_type"],
    },
  },
  {
    name: "search_news",
    description:
      "Search recent news for a targeted query (e.g. 'Grammarly funding announcement', 'Jasper new CEO'). Returns titles, URLs, and snippets. Use for funding, launches, leadership changes, partnerships.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        time_range: {
          type: "string",
          enum: ["day", "week", "month"],
          description: "defaults to week",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "record_signal",
    description:
      "Record a meaningful competitive signal. Provide before_scrape_id + after_scrape_id for diff-based signals (pricing, hiring, feature, messaging) OR source_url for news-based signals. Every signal must cite a receipt.",
    input_schema: {
      type: "object",
      properties: {
        competitor_id: { type: "string" },
        signal_type: {
          type: "string",
          enum: ["pricing", "hiring", "feature", "news", "messaging"],
        },
        summary: {
          type: "string",
          description:
            "one sentence: what changed and why a founder should care",
        },
        before_scrape_id: { type: "string" },
        after_scrape_id: { type: "string" },
        source_url: { type: "string" },
        confidence: {
          type: "number",
          description: "0.0 (low) to 1.0 (high)",
        },
      },
      required: ["competitor_id", "signal_type", "summary", "confidence"],
    },
  },
];

const SYSTEM_PROMPT = `You are an overnight competitive intelligence analyst working for the founder of ToneSwap, an AI writing/tone product.

Your job: investigate tracked competitors and record any meaningful changes since the last run. Focus on signals a founder would actually care about:
- Pricing changes (new tiers, price shifts)
- New features shipped (visible on product/pricing pages)
- Hiring spikes (careers page growing significantly)
- Funding, leadership changes, major partnerships (from news)
- Positioning/messaging shifts on the homepage

Method:
1. Call list_competitors first.
2. For each competitor: pick the most informative page (usually pricing_page), call scrape_page, then diff_latest on that source_type. If diff shows real change, record_signal citing before_scrape_id + after_scrape_id. Ignore cosmetic/whitespace noise.
3. Run search_news for any competitor you suspect has news worth flagging (launches, funding). Record those with source_url.
4. When every competitor has been investigated, STOP. Do not loop.

Hard rules:
- Every signal must cite a scrape_id or source_url. No signals without receipts.
- If no real changes were found for a competitor, just move on. Reporting nothing is better than fabricating.
- Keep summaries one sentence, specific, and actionable.`;

type ToolOutcome =
  | { ok: true; content: string }
  | { ok: false; content: string };

async function executeTool(
  name: string,
  input: Record<string, any>,
  userId: string,
  emit: (event: AgentEvent) => void,
): Promise<ToolOutcome> {
  try {
    if (name === "list_competitors") {
      const rows = getDb()
        .prepare(
          `SELECT id, name, website, pricing_page, careers_page FROM competitors WHERE user_id = ?`,
        )
        .all(userId) as Competitor[];
      return { ok: true, content: JSON.stringify(rows) };
    }

    if (name === "scrape_page") {
      const scrape = await scrapeAndStore({
        competitorId: input.competitor_id,
        sourceType: input.source_type,
        url: input.url,
      });
      return {
        ok: true,
        content: JSON.stringify({
          scrape_id: scrape.id,
          chars: scrape.raw_content.length,
          hash: scrape.content_hash.slice(0, 12),
        }),
      };
    }

    if (name === "diff_latest") {
      const diff = diffLatestTwo({
        competitorId: input.competitor_id,
        sourceType: input.source_type,
      });
      if (!diff) {
        return {
          ok: true,
          content: JSON.stringify({
            changed: false,
            reason: "no prior scrape to compare against",
          }),
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
          changed: diff.changed,
          before_scrape_id: diff.before.id,
          after_scrape_id: diff.after.id,
          added_count: diff.addedLines.length,
          removed_count: diff.removedLines.length,
          added_lines: diff.addedLines.slice(0, 40),
          removed_lines: diff.removedLines.slice(0, 40),
        }),
      };
    }

    if (name === "search_news") {
      const response = await searchNews(input.query, {
        timeRange: input.time_range ?? "week",
        maxResults: 5,
      });
      return {
        ok: true,
        content: JSON.stringify({
          answer: response.answer,
          results: response.results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 500),
            published: r.publishedDate,
          })),
        }),
      };
    }

    if (name === "record_signal") {
      const competitor = getDb()
        .prepare(`SELECT name FROM competitors WHERE id = ?`)
        .get(input.competitor_id) as { name: string } | undefined;

      const id = randomUUID();
      getDb()
        .prepare(
          `INSERT INTO signals (id, competitor_id, signal_type, summary, before_scrape_id, after_scrape_id, source_url, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.competitor_id,
          input.signal_type,
          input.summary,
          input.before_scrape_id ?? null,
          input.after_scrape_id ?? null,
          input.source_url ?? null,
          input.confidence,
        );

      emit({
        type: "signal_recorded",
        competitor: competitor?.name ?? "?",
        signal_type: input.signal_type,
        summary: input.summary,
        confidence: input.confidence,
      });

      return { ok: true, content: JSON.stringify({ signal_id: id }) };
    }

    return { ok: false, content: `Unknown tool: ${name}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, content: JSON.stringify({ error: message }) };
  }
}

function summarizeToolResult(name: string, content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (name === "list_competitors")
      return `${Array.isArray(parsed) ? parsed.length : 0} competitors`;
    if (name === "scrape_page") return `${parsed.chars} chars, ${parsed.hash}`;
    if (name === "diff_latest") {
      if (!parsed.changed) return parsed.reason ?? "no change";
      return `+${parsed.added_count ?? 0} / -${parsed.removed_count ?? 0}`;
    }
    if (name === "search_news") return `${parsed.results?.length ?? 0} results`;
    if (name === "record_signal") return `stored ${parsed.signal_id?.slice(0, 8) ?? ""}`;
  } catch {}
  return "ok";
}

export async function* runAgent(
  userId: string,
  userMessage?: string,
): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const buffered: AgentEvent[] = [];
  const emit = (e: AgentEvent) => buffered.push(e);

  const client = new Anthropic();

  const competitors = getDb()
    .prepare(`SELECT name FROM competitors WHERE user_id = ?`)
    .all(userId) as Array<{ name: string }>;
  yield { type: "status", text: `Starting run for ${competitors.length} competitors` };

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        userMessage ??
        `Run today's investigation. User id: ${userId}. Start with list_competitors.`,
    },
  ];

  let signalCount = 0;
  const maxTurns = 40;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses: Array<{ id: string; name: string; input: Record<string, any> }> = [];
      for (const block of response.content) {
        if (block.type === "text") {
          if (block.text.trim()) yield { type: "thinking", text: block.text };
        } else if (block.type === "tool_use") {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, any>,
          });
        }
      }

      if (response.stop_reason === "end_turn" || toolUses.length === 0) {
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        yield { type: "tool_call", name: use.name, input: use.input };
        const outcome = await executeTool(use.name, use.input, userId, emit);
        while (buffered.length) yield buffered.shift()!;
        if (use.name === "record_signal" && outcome.ok) signalCount++;
        yield {
          type: "tool_result",
          name: use.name,
          ok: outcome.ok,
          summary: outcome.ok
            ? summarizeToolResult(use.name, outcome.content)
            : outcome.content.slice(0, 200),
        };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: outcome.content,
          is_error: !outcome.ok,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    yield { type: "done", signals: signalCount, duration_ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
  }
}
