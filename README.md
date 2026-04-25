# Daily Founder Brief

Overnight competitive-intelligence agent for founders.

The agent wakes up, scrapes the pricing/careers/homepage of each tracked competitor, diffs against a stored prior snapshot, runs targeted news searches, records meaningful signals with receipts (scrape diff IDs or source URLs), and composes a morning brief that lands in the founder's inbox.

Built for Big Berlin Hack 2026.

## Stack

- **Next.js 16** (App Router, Turbopack) for the live agent terminal at `/`
- **SQLite** (`better-sqlite3`) for users, competitors, scrapes, signals, briefs
- **Tavily** for live scrape (`/extract`) and news search (`/search`)
- **Claude** (Opus 4.7 agent loop, Sonnet 4.6 brief composer) via `@anthropic-ai/sdk`, with the Anthropic MCP connector as the integration surface for sponsor MCPs
- **Peec AI MCP** (when `PEEC_MCP_TOKEN` is set) for share-of-voice and brand-visibility tracking across AI search engines
- **React Email + Resend** for the brief itself

## Setup

```bash
cp .env.example .env.local     # then fill in the keys
npm install
npm run seed                   # creates data/app.db with user + 6 seed competitors
npm run seed:wayback           # pulls historical baselines from archive.org so today's diffs are non-empty
npm run dev                    # opens the live agent terminal at http://localhost:3000
```

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
