import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getDb, type Competitor } from "./db";
import { diffLatestTwo } from "./diff";
import { analyzeScreenshot } from "./gemini";
import { getAccessToken } from "./oauth/peec";
import { takeScreenshot } from "./screenshot";
import { scrapeAndStore, searchNews } from "./tavily";

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

// Default to Sonnet for hackathon demo speed (each turn ~2-3x faster than Opus).
// Override via AGENT_MODEL=claude-opus-4-7 for production-quality reasoning.
const MODEL = process.env.AGENT_MODEL ?? "claude-sonnet-4-6";

const PEEC_MCP_URL = "https://api.peec.ai/mcp";
const PEEC_ALLOWED_TOOLS = [
  "list_projects",
  "list_brands",
  "list_prompts",
  "list_chats",
  "get_chat",
  "get_brand_report",
  "get_actions",
];

async function resolvePeecToken(): Promise<string | null> {
  const oauthToken = await getAccessToken().catch(() => null);
  if (oauthToken) return oauthToken;
  return process.env.PEEC_MCP_TOKEN ?? null;
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; summary: string }
  | {
      type: "mcp_tool_call";
      server: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "mcp_tool_result";
      server: string;
      name: string;
      ok: boolean;
      summary: string;
    }
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
    name: "visual_check",
    description:
      "Capture a fresh screenshot of a competitor URL with a headless Chromium browser, then ask Gemini 2.x (multimodal) to extract a structured readout: pricing tiers, hero text, prominent CTAs, banners, named features. Use this when scrape diffs or news leave gaps - especially to verify visible pricing or to surface launch banners that text scraping might miss. The result is a Gemini analysis you can use to inform record_signal calls (cite the saved screenshot path as the source_url).",
    input_schema: {
      type: "object",
      properties: {
        competitor_id: { type: "string" },
        source_type: {
          type: "string",
          enum: ["homepage", "pricing", "careers"],
        },
        url: { type: "string" },
      },
      required: ["competitor_id", "source_type", "url"],
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

const TODAY = () => new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are an overnight competitive intelligence analyst working for the founder of ToneSwap, an AI writing/tone product.

Today's date is ${TODAY()}. Use this as your reference for "now" - any date-range parameter you pass to a tool (Peec brand reports, news searches, etc.) must end on or near this date. Do not use dates from your training data; today is ${TODAY()}.

Your job: investigate tracked competitors and record any meaningful changes since the last run. Focus on signals a founder would actually care about:
- Pricing changes (new tiers, price shifts)
- New features shipped (visible on product/pricing pages)
- Hiring spikes (careers page growing significantly)
- Funding, leadership changes, major partnerships (from news)
- Positioning/messaging shifts on the homepage

Method:
1. Call list_competitors first.
2. For each competitor: pick the most informative page (usually pricing_page), call scrape_page, then diff_latest on that source_type. If diff shows real change, record_signal citing before_scrape_id + after_scrape_id. Ignore cosmetic/whitespace noise.
3. Always run visual_check on each competitor's pricing_page. Gemini's structured readout (page type, headline, pricing tiers with prices, CTAs, banners, named features) catches what text scraping misses: visible pricing changes, new tier launches, banners, messaging emphasis. If the readout reveals something not in your scrape diff (e.g. a new tier, a price change, a launch banner), record_signal citing the saved screenshot path as source_url.
4. Run search_news for any competitor you suspect has news worth flagging (launches, funding). Record those with source_url.
5. When every competitor has been investigated, STOP. Do not loop.

Hard rules:
- Every signal must cite a scrape_id or source_url. No signals without receipts.
- If no real changes were found for a competitor, just move on. Reporting nothing is better than fabricating.
- Keep summaries one sentence, specific, and actionable.`;

function buildPeecPrompt(projectId: string | null): string {
  const today = TODAY();
  const projectInstruction = projectId
    ? `\nUse Peec project id "${projectId}" exclusively. Pass this id as the project_id argument to list_brands and get_brand_report. Do not call list_projects to choose another - the active project is fixed.\n`
    : `\nFirst call list_projects. Find the project whose name is exactly "Big Berlin Hack - Camillus" (note the trailing "- Camillus" - DO NOT pick the unrelated "Big Berlin Hack" project, which tracks solar/renewable energy brands and has no relation to ToneSwap's competitor set). If "Big Berlin Hack - Camillus" is not present, pick a project whose tracked brands include "ToneSwap" or "Grammarly" or "Jasper". Do not pick projects tracking unrelated industries.\n`;

  return `

You also have access to Peec AI MCP tools for tracking how brands appear in AI search engines (ChatGPT, Claude, Perplexity, Gemini). These complement scrape diffs and news searches by adding a third signal type: share-of-voice and visibility shifts in LLM answers.

Peec AI workflow - mandatory, not optional:
${projectInstruction}
STEP 0 (run BEFORE any per-competitor work): Call list_brands for the active project. Do not skip. Do not infer which brands are tracked from prior context - actually call the tool. Its output tells you which competitors have Peec data available for this run.

After step 0, when you investigate each competitor:
- If the competitor's name appears in list_brands output: call get_brand_report for that brand. Use a recent date window: end_date should be today (${today}) and start_date should be 7-14 days before that. Do not pass dates from 2024 or 2025 unless explicitly asked for historical analysis - Peec data is collected daily and the freshest data is the most signal-worthy.
- When you receive brand report data, record a signal whenever any of the following is true:
  - Share-of-voice shifted by 5 percentage points or more vs the prior period.
  - Sentiment moved by 5 points or more.
  - Average position changed by 0.5 or more.
  - The brand's current visibility is notably high (>= 25%) or notably low (<= 5%) compared to the founder's brand (ToneSwap) - even on a single-day baseline, the share-of-voice gap itself is signal-worthy. Example: "Grammarly leads LLM visibility at 35% vs ToneSwap at 2% - distribution gap is the moat to attack."
  - For these signals: signal_type should be "messaging", confidence 0.6-0.85 depending on data freshness (lower if only 1 day of data), and the receipt should be the Peec brand report itself - cite the project_id and brand_id in the source_url field as a peec://-style identifier.
- If the competitor is NOT in list_brands: do not invent a brand id; skip Peec for that competitor and rely on scrape + news.
- get_actions is optional - call it only if a brand_report surfaces a clear opportunity that translates to a founder action.

Treat Peec AI as supplementary intelligence on top of scrape + news, not a replacement.`;
}

function buildSystemPrompt(peecEnabled: boolean) {
  if (!peecEnabled) return SYSTEM_PROMPT;
  const projectId = process.env.PEEC_PROJECT_ID ?? null;
  return SYSTEM_PROMPT + buildPeecPrompt(projectId);
}

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

    if (name === "visual_check") {
      const shot = await takeScreenshot({
        url: input.url,
        competitorId: input.competitor_id,
        sourceType: input.source_type,
      });
      const analysis = await analyzeScreenshot({
        imageBuffer: shot.buffer,
        prompt: VISUAL_PROMPT,
      });
      return {
        ok: true,
        content: JSON.stringify({
          screenshot_path: shot.path,
          screenshot_bytes: shot.bytes,
          viewport: shot.viewport,
          analysis,
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
    if (name === "visual_check")
      return `${Math.round((parsed.screenshot_bytes ?? 0) / 1024)}KB, ${(parsed.analysis ?? "").length} chars`;
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

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        userMessage ??
        `Run today's investigation. User id: ${userId}. Start with list_competitors.`,
    },
  ];

  const peecToken = await resolvePeecToken();
  const usePeec = Boolean(peecToken);
  const mcpServers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = usePeec
    ? [
        {
          name: "peec",
          type: "url",
          url: PEEC_MCP_URL,
          authorization_token: peecToken!,
        },
      ]
    : [];

  const peecToolset: Anthropic.Beta.BetaMCPToolset = {
    type: "mcp_toolset",
    mcp_server_name: "peec",
    default_config: { enabled: false },
    configs: Object.fromEntries(
      PEEC_ALLOWED_TOOLS.map((name) => [name, { enabled: true }]),
    ),
  };

  if (usePeec) {
    yield { type: "status", text: "Peec AI MCP enabled" };
  }

  let signalCount = 0;
  const maxTurns = 40;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const requestTools: Array<
        Anthropic.Beta.BetaTool | Anthropic.Beta.BetaMCPToolset
      > = [...tools];
      if (usePeec) {
        requestTools.push(peecToolset);
      }

      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: buildSystemPrompt(usePeec),
        tools: requestTools,
        messages,
        ...(usePeec
          ? {
              mcp_servers: mcpServers,
              betas: ["mcp-client-2025-11-20"],
            }
          : {}),
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
        } else if (block.type === "mcp_tool_use") {
          yield {
            type: "mcp_tool_call",
            server: block.server_name,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          };
        } else if (block.type === "mcp_tool_result") {
          const summary =
            typeof block.content === "string"
              ? block.content.slice(0, 240)
              : Array.isArray(block.content)
                ? block.content
                    .map((b) => (b.type === "text" ? b.text : ""))
                    .join("")
                    .slice(0, 240)
                : "";
          yield {
            type: "mcp_tool_result",
            server: "peec",
            name: "(mcp)",
            ok: !block.is_error,
            summary: summary || (block.is_error ? "error" : "ok"),
          };
        }
      }

      if (response.stop_reason === "end_turn" || toolUses.length === 0) {
        break;
      }

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
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
