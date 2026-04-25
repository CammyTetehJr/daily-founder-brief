import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ComposedBrief } from "./compose";
import { safePathSegment } from "./path-safety";

const TTS_ENDPOINT = "https://api.gradium.ai/api/post/speech/tts";
const DEFAULT_VOICE_ID = process.env.GRADIUM_VOICE_ID ?? "YTpq7expH9539ERJ";
const DEFAULT_MODEL = process.env.GRADIUM_MODEL ?? "default";

export type VoiceBriefResult = {
  path: string;
  bytes: number;
  durationApproxSeconds: number;
};

// Gradium TTS hard limit is 3000 chars per call. Keep the audio script
// well under that by capping signal count and length, plus a final
// guard that truncates at sentence boundary if a long input slips through.
const VOICE_MAX_CHARS = 2700;
const VOICE_MAX_SIGNALS = 3;
const VOICE_MAX_ACTIONS = 3;

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
    const top = [...brief.signal_bullets]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, VOICE_MAX_SIGNALS);
    lines.push("");
    lines.push(
      top.length < brief.signal_bullets.length
        ? `Top ${top.length} of ${brief.signal_bullets.length} signals.`
        : "Here is what changed.",
    );
    for (const b of top) {
      lines.push(`${b.competitor}, ${b.signal_type}. ${b.one_liner}`);
    }
  }

  lines.push("");
  lines.push("What this means.");
  lines.push(brief.what_it_means);

  if (brief.actions.length > 0) {
    const topActions = brief.actions.slice(0, VOICE_MAX_ACTIONS);
    lines.push("");
    lines.push("Today's actions.");
    for (let i = 0; i < topActions.length; i++) {
      lines.push(`${i + 1}. ${topActions[i]}`);
    }
  }

  lines.push("");
  lines.push("That is your brief. Have a good morning.");

  let script = lines.join(" ");
  if (script.length > VOICE_MAX_CHARS) {
    // Truncate to sentence boundary just below the limit.
    const cut = script.lastIndexOf(".", VOICE_MAX_CHARS);
    script = (cut > 0 ? script.slice(0, cut + 1) : script.slice(0, VOICE_MAX_CHARS)).trim();
  }
  return script;
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

  const contentType = res.headers.get("content-type") ?? "";
  const audioBuffer = Buffer.from(await res.arrayBuffer());

  if (audioBuffer.length === 0) {
    throw new Error(
      `Gradium TTS returned empty body (status ${res.status}, content-type ${contentType}). Script length was ${text.length} chars.`,
    );
  }
  if (contentType.includes("application/json")) {
    throw new Error(
      `Gradium TTS returned JSON instead of audio: ${audioBuffer.toString("utf8").slice(0, 300)}`,
    );
  }

  const safeBriefId = safePathSegment(params.briefId, "briefId");
  const dir = resolve(process.cwd(), "data", "audio");
  const path = resolve(dir, `${safeBriefId}.wav`);
  if (!path.startsWith(dir + "/")) {
    throw new Error("resolved audio path escaped data/audio");
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, audioBuffer);

  // Rough duration estimate: ~16 chars per second of natural speech.
  const approxSeconds = Math.round((text.length / 16) * 10) / 10;

  return {
    path,
    bytes: audioBuffer.length,
    durationApproxSeconds: approxSeconds,
  };
}
