# Daily Founder Brief

Overnight competitive-intelligence agent for founders.

The agent wakes up, scrapes the pricing/careers/homepage of each tracked competitor, diffs against a stored prior snapshot, runs targeted news searches, records meaningful signals with receipts (scrape diff IDs or source URLs), and composes a morning brief that lands in the founder's inbox.

Built for Big Berlin Hack 2026.

## Stack

- **Next.js 16** (App Router, Turbopack) for the live agent terminal at `/`
- **SQLite** (`better-sqlite3`) for users, competitors, scrapes, signals, briefs
- **Tavily** for live scrape (`/extract`) and news search (`/search`)
- **Claude** (Opus 4.7 agent loop, Sonnet 4.6 brief composer) via `@anthropic-ai/sdk`, with the Anthropic MCP connector as the integration surface for sponsor MCPs
- **Google Gemini** (`@google/genai`, Vertex AI mode) for multimodal `visual_check` — screenshot via Playwright, structured readout of pricing tiers, headlines, banners, named features
- **Peec AI MCP** (OAuth via `/api/auth/peec/start`) for share-of-voice and brand-visibility tracking across AI search engines
- **Gradium** for the morning voice brief (60-90s wav saved to `data/audio/`)
- **Entire** captures every Claude Code session and links each commit to a checkpoint via `Entire-Checkpoint` trailers — agent-human collaboration loop. Push events run `[entire] Pushing entire/checkpoints/v1 to origin` and the captured sessions are replayable at [entire.io](https://entire.io). Run `npm run dispatch` for an AI-generated summary of recent agent work.
- **React Email + Resend** for the brief itself

## Setup

```bash
cp .env.example .env.local     # then fill in the keys
npm install
npx playwright install chromium # one-time, for visual_check screenshots
npm run seed                   # creates data/app.db with user + 6 seed competitors
npm run seed:wayback           # pulls historical baselines from archive.org so today's diffs are non-empty
npm run dev                    # opens the live agent terminal at http://localhost:3000
```

For Gemini: run `gcloud auth application-default login` so Vertex AI can use ADC.

For Peec AI: open the running app, click **connect peec** in the header, complete the OAuth flow, then re-run.

For Entire (session capture, side challenge): `brew tap entireio/tap && brew install --cask entire && entire enable && entire login` from this repo. Future Claude Code sessions are captured automatically; commits carry `Entire-Checkpoint` trailers; `entire activity` shows dashboard data.

## How this was built (via Entire)

This project's Claude Code development sessions are captured by [Entire](https://entire.io). Every commit pushed from this repo includes an `Entire-Checkpoint` trailer that judges and reviewers can resolve back to the originating session, complete with the prompts, tool calls, file edits, and token counts that produced each change.

Run `npm run dispatch` (after `entire login`) to get an AI-generated narrative of the last 24 hours of work in this repo. The same data is browsable at the entire.io dashboard.

Why this matters for the project: this repo *is itself* an "agent-human collaboration" artifact - the Daily Founder Brief was built by a Claude Code agent under human direction, captured frame-by-frame by Entire. The same shape of collaboration loop the product offers founders for competitive intel, Entire offers developers for code.

Required env vars:

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API |
| `TAVILY_API_KEY` | Tavily scrape + search |
| `RESEND_API_KEY` | Brief delivery |
| `FROM_EMAIL` | Sender address (must be on a Resend-verified domain) |
| `SEED_USER_EMAIL` | Email seeded as the demo user (where briefs get sent) |
| `PEEC_MCP_TOKEN` | Optional. Bearer token for the Peec AI MCP server (https://api.peec.ai/mcp). When set, the agent gets brand-visibility tools alongside scrape/diff/news. |

## Architecture

```
┌── app/page.tsx (live terminal UI) ──── app/api/run/route.ts (SSE stream) ─┐
│                                                                            │
└─→ lib/pipeline.ts ─→ lib/agent.ts ─→ tools: list_competitors, scrape_page, │
                                              diff_latest, search_news,      │
                                              record_signal                  │
                  └─→ lib/compose.ts ─→ lib/email-templates/FounderBrief.tsx │
                                    └─→ lib/email.ts ─→ Resend               │
```

Snapshot-and-diff is the core anti-hallucination primitive: every scrape is stored raw in the `scrapes` table, and every recorded signal cites a `before_scrape_id` + `after_scrape_id` (or a `source_url` for news-based signals). No receipts, no signal.

## CLI scripts

```bash
npm run seed                 # seed user + competitors
npm run seed:wayback         # populate historical baselines via archive.org
npm run test:scrape          # smoke-test Tavily extract + diff
npm run test:agent <name>    # run agent scoped to one competitor
npm run test:brief           # full pipeline: agent -> compose -> render -> send
                             #   flags: -- --dry-run, --skip-agent, --scope=<name>
npm run verify:diff <name> <source_type>   # scrape one URL and diff vs. baseline
```

## Layout

```
schema.sql                          SQLite schema
lib/db.ts                           DB wrapper + typed rows
lib/tavily.ts                       extract + search wrappers, snapshot storage
lib/diff.ts                         line-level diff over latest two scrapes
lib/agent.ts                        Claude agent loop, 5 tools, streaming events
lib/compose.ts                      Sonnet brief composer with em-dash sanitize
lib/email-templates/FounderBrief.tsx   dark-minimal React Email
lib/email.ts                        Resend wrapper
lib/pipeline.ts                     agent -> compose -> render -> send orchestrator
app/page.tsx                        live agent terminal (dark mono, SSE)
app/api/run/route.ts                SSE pipeline endpoint
scripts/                            seed, test, verify scripts
```
