import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ComposedBrief } from "./compose";

const TTS_ENDPOINT = "https://api.gradium.ai/api/post/speech/tts";
const DEFAULT_VOICE_ID = process.env.GRADIUM_VOICE_ID ?? "YTpq7expH9539ERJ";
const DEFAULT_MODEL = process.env.GRADIUM_MODEL ?? "default";

export type VoiceBriefResult = {
  path: string;
  bytes: number;
  durationApproxSeconds: number;
};

export function buildVoiceScript(brief: ComposedBrief): string {
  const lines: string[] = [];
  lines.push("Good morning. Here is your daily founder brief.");
  lines.push("");
  lines.push(brief.headline + ".");
  lines.push(
    `Threat level ${brief.threat_level} out of ten. ${brief.signal_bullets.length} signal${brief.signal_bullets.length === 1 ? "" : "s"} today.`,
  );
  lines.push("");
  lines.push(brief.opening);

  if (brief.signal_bullets.length > 0) {
    lines.push("");
    lines.push("Here is what changed.");
    for (const b of brief.signal_bullets) {
      lines.push(`${b.competitor}, ${b.signal_type}. ${b.one_liner}`);
    }
  }

  lines.push("");
  lines.push("What this means.");
  lines.push(brief.what_it_means);

  if (brief.actions.length > 0) {
    lines.push("");
    lines.push("Today's actions.");
    for (let i = 0; i < brief.actions.length; i++) {
      lines.push(`${i + 1}. ${brief.actions[i]}`);
    }
  }

  lines.push("");
  lines.push("That is your brief. Have a good morning.");

  return lines.join(" ");
}

export async function generateVoiceBrief(params: {
  brief: ComposedBrief;
  briefId: string;
}): Promise<VoiceBriefResult> {
  const apiKey = process.env.GRADIUM_API_KEY;
  if (!apiKey) throw new Error("GRADIUM_API_KEY is not set");

  const text = buildVoiceScript(params.brief);

  const res = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: DEFAULT_VOICE_ID,
      output_format: "wav",
      model_name: DEFAULT_MODEL,
      only_audio: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gradium TTS ${res.status}: ${body.slice(0, 200)}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());

  const dir = join(process.cwd(), "data", "audio");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${params.briefId}.wav`);
  writeFileSync(path, audioBuffer);

  // Rough duration estimate: ~16 chars per second of natural speech.
  const approxSeconds = Math.round((text.length / 16) * 10) / 10;

  return {
    path,
    bytes: audioBuffer.length,
    durationApproxSeconds: approxSeconds,
  };
}
