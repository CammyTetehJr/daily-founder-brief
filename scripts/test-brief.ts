import { render } from "@react-email/components";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";

import { runAgent } from "../lib/agent";
import { composeBrief, getRecentSignals } from "../lib/compose";
import { getDb } from "../lib/db";
import { sendBrief } from "../lib/email";
import { FounderBriefEmail } from "../lib/email-templates/FounderBrief";
import { generateVoiceBrief } from "../lib/gradium";

const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function arg(flag: string): string | undefined {
  for (const a of process.argv.slice(2)) {
    if (a === flag) return "true";
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return undefined;
}

async function main() {
  const dryRun = arg("--dry-run") !== undefined;
  const skipAgent = arg("--skip-agent") !== undefined;
  const scope = arg("--scope");

  const user = getDb()
    .prepare(`SELECT id, email FROM users LIMIT 1`)
    .get() as { id: string; email: string } | undefined;
  if (!user) throw new Error("Run `npm run seed` first.");

  console.log(`${GRAY}user:      ${user.email}${RESET}`);
  console.log(`${GRAY}scope:     ${scope ?? "all competitors"}${RESET}`);
  console.log(`${GRAY}dry-run:   ${dryRun}${RESET}`);
  console.log(`${GRAY}run agent: ${!skipAgent}${RESET}\n`);

  if (!skipAgent) {
    const userMessage = scope
      ? `Investigate ONLY the competitor named "${scope}" for today's run. User id: ${user.id}. Start with list_competitors, then focus only on that row.`
      : undefined;

    for await (const ev of runAgent(user.id, userMessage)) {
      switch (ev.type) {
        case "status":
          console.log(`${CYAN}[status]${RESET} ${ev.text}`);
          break;
        case "tool_call":
          console.log(
            `${YELLOW}> ${ev.name}${RESET} ${GRAY}${JSON.stringify(ev.input).slice(0, 120)}${RESET}`,
          );
          break;
        case "tool_result":
          console.log(`  ${ev.ok ? GREEN + "ok" : RED + "fail"}${RESET}  ${ev.summary}`);
          break;
        case "signal_recorded":
          console.log(
            `${GREEN}[signal]${RESET} ${ev.competitor} / ${ev.signal_type}: ${ev.summary}`,
          );
          break;
        case "done":
          console.log(
            `${GREEN}[done]${RESET} ${ev.signals} signals in ${(ev.duration_ms / 1000).toFixed(1)}s\n`,
          );
          break;
        case "error":
          console.log(`${RED}[error]${RESET} ${ev.message}`);
          break;
      }
    }
  }

  const signals = getRecentSignals(user.id);
  console.log(`${CYAN}[compose]${RESET} ${signals.length} signal${signals.length === 1 ? "" : "s"} in last 24h`);

  const brief = await composeBrief({ signals });
  console.log(`  subject:     ${brief.subject_line}`);
  console.log(`  threat:      ${brief.threat_level}/10`);
  console.log(`  bullets:     ${brief.signal_bullets.length}`);
  console.log(`  actions:     ${brief.actions.length}`);

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const html = await render(
    React.createElement(FounderBriefEmail, { brief, date: dateStr }),
  );

  const previewPath = join(process.cwd(), "data", "preview.html");
  writeFileSync(previewPath, html);
  console.log(`${CYAN}[preview]${RESET} ${previewPath}`);

  const briefId = randomUUID();

  if (process.env.GRADIUM_API_KEY) {
    console.log(`${CYAN}[voice]${RESET} generating audio brief via Gradium...`);
    try {
      const voice = await generateVoiceBrief({ brief, briefId });
      console.log(
        `  ${Math.round(voice.bytes / 1024)} KB · ~${voice.durationApproxSeconds.toFixed(1)}s · ${voice.path}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${RED}voice failed${RESET}: ${message}`);
    }
  } else {
    console.log(`${GRAY}[voice]${RESET} skipped (no GRADIUM_API_KEY)`);
  }

  if (dryRun) {
    console.log(`${YELLOW}[dry-run]${RESET} not sending. open the preview file in a browser.`);
    return;
  }

  console.log(`${CYAN}[send]${RESET} -> ${user.email}`);
  const sent = await sendBrief({
    to: user.email,
    subject: brief.subject_line,
    html,
  });
  console.log(`  resend id: ${sent.id}`);

  getDb()
    .prepare(
      `INSERT INTO briefs
         (id, user_id, subject_line, html_content, analysis_json, signal_ids, threat_level, sent_at, resend_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      briefId,
      user.id,
      brief.subject_line,
      html,
      JSON.stringify(brief),
      JSON.stringify(signals.map((s) => s.id)),
      brief.threat_level,
      new Date().toISOString(),
      sent.id,
    );
  console.log(`${GREEN}[done]${RESET} brief ${briefId.slice(0, 8)} stored`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
