import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { isValidAudioFilename } from "@/lib/audio-filename";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!isValidAudioFilename(name)) {
    return new Response("invalid filename", { status: 400 });
  }

  const audioPath = join(process.cwd(), "data", "audio", name);
  if (!existsSync(audioPath)) {
    return new Response("not found", { status: 404 });
  }

  const stats = statSync(audioPath);
  const buffer = readFileSync(audioPath);

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": stats.size.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}
