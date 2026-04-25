# Daily Founder Brief

An overnight competitive intelligence agent that watches a founder's competitors while they sleep, then drops a synthesised brief in their inbox by morning. Built for [Big Berlin Hack 2026](https://luma.com/bigberlinhack).

```
3am: agent wakes up
3am: scrapes 6 competitors  -> Tavily
3am: diffs vs. archived baselines from 90 days ago
3am: takes screenshots, asks Gemini what changed visually
3am: pulls AI search-engine share-of-voice from Peec AI
3am: composes a structured brief with Claude
3am: generates a 90-second voice version with Gradium
3am: sends the email via Resend
7am: founder opens inbox, reads brief, hears it on the commute
```

## What it does

The agent runs five tools against six tracked competitors (Grammarly, QuillBot, Wordtune, ProWritingAid, LanguageTool, Jasper):

1. `scrape_page` writes a timestamped snapshot of each pricing / careers / homepage page.
2. `diff_latest` compares today's snapshot against a 90-day-old Wayback Machine baseline.
3. `visual_check` screenshots the page in headless Chromium, sends it to Gemini 2.5 Flash for a structured readout (pricing tiers, hero copy, banners, named features).
4. `search_news` runs a targeted news query through Tavily.
5. `record_signal` stores anything signal-worthy with a receipt: a scrape diff ID, a news URL, or a Peec brand report ID. No signal without receipts.

The agent then has access to Peec AI's MCP tools (via Anthropic's MCP connector) for share-of-voice and visibility data across ChatGPT, Claude, Perplexity, and Google AI Overviews. After the loop, a separate Sonnet call composes the brief, a React Email template renders it, Gradium synthesises a voice version, Resend ships the email.

The whole pipeline streams to a dark, mono-font terminal at `http://localhost:3000` so you can watch the agent work live.

## Architecture

```
                        ┌──────────────────────┐
                        │  app/page.tsx        │
                        │  live agent terminal │
                        │  (SSE consumer)      │
                        └──────────┬───────────┘
                                   │
                        ┌──────────▼───────────┐
                        │  app/api/run         │
                        │  SSE pipeline        │
                        └──────────┬───────────┘
                                   │
                  ┌────────────────▼────────────────┐
                  │  lib/pipeline.ts                │
                  │  agent → compose → voice → send │
                  └─┬──────┬──────┬──────┬──────┬───┘
                    │      │      │      │      │
              ┌─────▼┐  ┌──▼─┐  ┌─▼──┐ ┌─▼───┐ ┌▼─────┐
              │agent │  │comp│  │TTS │ │email│ │ DB   │
              │5 tools│ │ose │  │    │ │     │ │ + FS │
              └──┬───┘  └────┘  └────┘ └─────┘ └──────┘
                 │
   ┌─────────────┼──────────────┐
   │             │              │
┌──▼───┐     ┌───▼────┐    ┌────▼────┐
│Tavily│     │Gemini  │    │Peec MCP │
│      │     │(visual)│    │(via OAuth)
└──────┘     └────────┘    └─────────┘
```

Snapshot-and-diff is the anti-hallucination spine: every scrape is stored raw in the `scrapes` table, and every signal cites a `before_scrape_id` + `after_scrape_id` for diff-based findings or a `source_url` for news / Peec findings. The agent's system prompt enforces "no receipts, no signal."

## Stack

| Tech | Role | Where |
|---|---|---|
| Next.js 16 (App Router, Turbopack) | Live agent terminal at `/`, SSE pipeline at `/api/run`, OAuth callbacks under `/api/auth/peec/*` | `app/` |
| SQLite via `better-sqlite3` | Users, competitors, scrapes (raw markdown), signals, briefs | `lib/db.ts`, `schema.sql` |
| Anthropic Claude | Opus 4.7 reserved for high-quality runs, Sonnet 4.6 default for speed; agent loop uses raw `messages` API plus the beta `mcp_servers` connector for Peec | `lib/agent.ts`, `lib/compose.ts` |
| Tavily | `extract` for pricing/careers/homepage scrape (markdown out), `search` with `topic: news` for news scans | `lib/tavily.ts` |
| Google Gemini (Vertex AI mode) | Multimodal `visual_check` tool. Playwright captures a 1440x1024 PNG of the live page, Gemini 2.5 Flash returns a structured readout (pricing tiers, headline, banners, named features) | `lib/gemini.ts`, `lib/screenshot.ts` |
| Peec AI MCP | Brand-visibility, share-of-voice, sentiment, average position across AI search engines. Wired through Anthropic's MCP connector with OAuth 2.1 + PKCE + dynamic client registration | `lib/oauth/peec.ts`, `app/api/auth/peec/*` |
| Gradium TTS | 60 to 90 second voice version of each brief, saved as wav to `data/audio/`, served back to the live terminal via `/api/audio/[name]` for inline playback | `lib/gradium.ts`, `app/api/audio/[name]/route.ts` |
| React Email + Resend | Dark, mono-font HTML email template, sent via Resend | `lib/email-templates/FounderBrief.tsx`, `lib/email.ts` |
| Internet Archive (Wayback) | Pre-seeded historical baselines so live diffs are non-empty on day one | `scripts/seed-wayback.ts` |
| Entire | Captures every Claude Code development session for this repo. Each commit carries an `Entire-Checkpoint` trailer that resolves to the full session transcript at [entire.io](https://entire.io) | git hooks installed by `entire enable` |
| Aikido | Continuous security scanning on the public repo. The HIGH severity path-traversal finding was fixed via `lib/path-safety.ts`'s allowlist validator | `lib/path-safety.ts` |

## Setup

```bash
cp .env.example .env.local     # then fill in the keys below
npm install
npx playwright install chromium # one-time, for visual_check screenshots
npm run seed                   # creates data/app.db with user + 6 seed competitors
npm run seed:wayback           # pulls historical baselines from archive.org
npm run dev                    # opens the live agent terminal at http://localhost:3000
```

### Environment variables

| Var | Required? | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude API for the agent and composer |
| `TAVILY_API_KEY` | yes | Web scrape and news search |
| `RESEND_API_KEY` | yes | Brief delivery |
| `FROM_EMAIL` | yes | Must be on a Resend-verified domain |
| `SEED_USER_EMAIL` | yes | Email seeded as the demo user (where briefs get sent) |
| `GOOGLE_CLOUD_PROJECT` | for visual_check | GCP project for Vertex AI; auth via `gcloud auth application-default login` |
| `GOOGLE_CLOUD_LOCATION` | optional | Defaults to `us-central1` |
| `GEMINI_MODEL` | optional | Defaults to `gemini-2.5-flash` |
| `GRADIUM_API_KEY` | for voice brief | Skipped gracefully if absent |
| `GRADIUM_VOICE_ID` | optional | Defaults to Emma (US English female) |
| `PEEC_MCP_TOKEN` | optional | Static fallback. Prefer the OAuth flow (see below) |
| `PEEC_PROJECT_ID` | optional | Pin a Peec project; otherwise the agent matches by name |
| `AGENT_MODEL` | optional | Defaults to `claude-sonnet-4-6`. Override with `claude-opus-4-7` for production-quality runs |

### One-time tool setup

**Gemini (Vertex AI):** the GCP project disallows API keys, so we use Application Default Credentials.

```bash
gcloud auth application-default login
```

**Peec AI:** open the running app, click `connect peec` in the header, complete OAuth in the browser. The token persists at `data/peec_token.json` and refreshes automatically.

**Entire (session capture, side challenge):**

```bash
brew tap entireio/tap && brew install --cask entire
entire enable
entire login
```

Future Claude Code sessions in this repo are captured automatically. Commits get an `Entire-Checkpoint` trailer; on push, hooks publish to a `entire/checkpoints/v1` ref alongside `main`.

## How to run a brief

The live terminal at `http://localhost:3000` is the demo path. Click `run`, watch the events stream, and either:

- Receive the email and play the voice file inline, or
- Toggle `dry-run` on to skip the email send while still generating preview HTML and audio locally.

Cost per full run with all 6 competitors: about $0.50 to $1 in API tokens (Sonnet agent, Gemini per visual_check, Tavily extract + search, Gradium TTS).

## CLI scripts

```bash
npm run seed                 # seed user + competitors into data/app.db
npm run seed:wayback         # backfill 90-day-old Wayback snapshots as diff baselines
npm run test:scrape          # smoke-test Tavily extract + diff
npm run test:visual <name> <source_type>  # one-shot screenshot + Gemini analysis
npm run test:voice           # standalone Gradium TTS test on a sample brief
npm run test:agent <name>    # run the agent scoped to one competitor
npm run test:brief           # full pipeline: agent + compose + voice + send
                             # flags: -- --dry-run --skip-agent --scope=<name>
npm run verify:diff <name> <source_type>  # scrape one URL and diff vs baseline
npm run dispatch             # entire dispatch summary of last 24h of dev work
```

## Repo layout

```
schema.sql                              SQLite schema
lib/
  db.ts                                 DB wrapper + typed rows
  path-safety.ts                        allowlist validator for any user-supplied path segment
  tavily.ts                             extract + search wrappers, snapshot storage
  diff.ts                               line-level diff over latest two scrapes
  gemini.ts                             Vertex AI client for screenshot analysis
  screenshot.ts                         Playwright headless Chromium capture
  agent.ts                              Claude agent loop, five tools, streaming events
  compose.ts                            Sonnet brief composer with em-dash and emoji strip
  gradium.ts                            TTS wrapper, voice script builder
  email-templates/FounderBrief.tsx      dark, mono-font React Email
  email.ts                              Resend wrapper
  pipeline.ts                           agent then compose then voice then send
  oauth/peec.ts                         PKCE, dynamic client reg, token refresh for Peec MCP
app/
  page.tsx                              live agent terminal, dark mono UI, SSE consumer
  api/run/route.ts                      SSE pipeline endpoint
  api/audio/[name]/route.ts             serves data/audio/*.wav for inline playback
  api/auth/peec/                        OAuth start, callback, status routes
scripts/
  seed.ts                               user + competitors
  seed-wayback.ts                       Wayback baselines
  test-*.ts                             standalone smoke tests
  verify-baseline-diff.ts               targeted scrape + diff verifier
```

## How this was built (Entire)

This project's Claude Code development sessions are captured by [Entire](https://entire.io). Every commit pushed from this repo carries an `Entire-Checkpoint` trailer that resolves to the full session transcript: prompts, tool calls, file diffs, token counts.

```bash
npm run dispatch
```

Generates an AI-written narrative of the last 24 hours of work in this repo. The same data is browsable at the entire.io dashboard.

The framing is symmetrical: this product is an agent that does competitive research while a founder sleeps, captured frame-by-frame so the founder can review it. Entire offers the same shape of agent-human collaboration loop, applied to code.

## Security notes

The repo is continuously scanned by [Aikido](https://aikido.dev). The HIGH severity path-traversal finding flagged at the start of the hackathon was resolved by adding an allowlist validator in `lib/path-safety.ts` that rejects any segment outside `[A-Za-z0-9._-]` and resolves the final path to assert it stays inside the intended `data/` subtree.

Two MEDIUM transitive CVEs (uuid via `resend` and postcss via `next`) remain documented but unresolved at submission time. Both `npm audit fix` paths require breaking-change downgrades of major deps; we accept the risk for the hackathon and would address via package overrides post-event.

## License

Built at Big Berlin Hack 2026. MIT-style use is fine for hackathon judging; production licensing TBD.
