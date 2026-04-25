import { getDb } from "@/lib/db";
import { runFullPipeline, type PipelineOptions } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const options: PipelineOptions = {
    scope: url.searchParams.get("scope") ?? undefined,
    dryRun: url.searchParams.get("dry") === "1",
    skipAgent: url.searchParams.get("skip_agent") === "1",
  };

  const user = getDb()
    .prepare("SELECT id FROM users LIMIT 1")
    .get() as { id: string } | undefined;
  if (!user) {
    return new Response("no user seeded; run `npm run seed`", { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const event of runFullPipeline(user.id, options)) {
          send(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
