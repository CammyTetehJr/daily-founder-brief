import { render } from "@react-email/components";
import { randomUUID } from "node:crypto";
import * as React from "react";

import { runAgent, type AgentEvent } from "./agent";
import { composeBrief, getRecentSignals } from "./compose";
import { getDb } from "./db";
import { sendBrief } from "./email";
import { FounderBriefEmail } from "./email-templates/FounderBrief";

export type PipelineEvent =
  | AgentEvent
  | { type: "composing" }
  | {
      type: "composed";
      subject: string;
      threat_level: number;
      bullets: number;
      actions: number;
    }
  | { type: "rendered"; html_chars: number }
  | { type: "sending"; to: string }
  | { type: "sent"; resend_id: string; brief_id: string }
  | { type: "dry_run" };

export type PipelineOptions = {
  scope?: string;
  dryRun?: boolean;
  skipAgent?: boolean;
};

export async function* runFullPipeline(
  userId: string,
  options: PipelineOptions = {},
): AsyncGenerator<PipelineEvent> {
  if (!options.skipAgent) {
    const userMessage = options.scope
      ? `Investigate ONLY the competitor named "${options.scope}" for today's run. User id: ${userId}. Start with list_competitors, then focus only on that row.`
      : undefined;
    for await (const ev of runAgent(userId, userMessage)) {
      yield ev;
      if (ev.type === "error") return;
    }
  }

  yield { type: "composing" };
  const signals = getRecentSignals(userId);
  const brief = await composeBrief({ signals });
  yield {
    type: "composed",
    subject: brief.subject_line,
    threat_level: brief.threat_level,
    bullets: brief.signal_bullets.length,
    actions: brief.actions.length,
  };

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const html = await render(
    React.createElement(FounderBriefEmail, { brief, date: dateStr }),
  );
  yield { type: "rendered", html_chars: html.length };

  if (options.dryRun) {
    yield { type: "dry_run" };
    return;
  }

  const user = getDb()
    .prepare("SELECT email FROM users WHERE id = ?")
    .get(userId) as { email: string } | undefined;
  if (!user) throw new Error("user not found");

  yield { type: "sending", to: user.email };
  const sent = await sendBrief({
    to: user.email,
    subject: brief.subject_line,
    html,
  });

  const briefId = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO briefs
         (id, user_id, subject_line, html_content, analysis_json, signal_ids, threat_level, sent_at, resend_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      briefId,
      userId,
      brief.subject_line,
      html,
      JSON.stringify(brief),
      JSON.stringify(signals.map((s) => s.id)),
      brief.threat_level,
      new Date().toISOString(),
      sent.id,
    );

  yield { type: "sent", resend_id: sent.id, brief_id: briefId };
}
