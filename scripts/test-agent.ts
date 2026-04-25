import { getDb } from "../lib/db";
import { runAgent } from "../lib/agent";

const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

async function main() {
  const user = getDb()
    .prepare(`SELECT id, email FROM users LIMIT 1`)
    .get() as { id: string; email: string } | undefined;
  if (!user) throw new Error("Run `npm run seed` first.");

  const scopeArg = process.argv[2];
  const userMessage = scopeArg
    ? `Investigate ONLY the competitor named "${scopeArg}" for today's run. User id: ${user.id}. Start with list_competitors, then focus only on that one row.`
    : undefined;

  console.log(`${GRAY}user: ${user.email}${RESET}`);
  console.log(`${GRAY}scope: ${scopeArg ?? "all competitors"}${RESET}\n`);

  for await (const event of runAgent(user.id, userMessage)) {
    switch (event.type) {
      case "status":
        console.log(`${CYAN}[status]${RESET} ${event.text}`);
        break;
      case "thinking":
        console.log(`${GRAY}${event.text}${RESET}`);
        break;
      case "tool_call":
        console.log(
          `${YELLOW}> ${event.name}${RESET} ${GRAY}${JSON.stringify(event.input).slice(0, 140)}${RESET}`,
        );
        break;
      case "tool_result":
        console.log(
          `  ${event.ok ? GREEN + "ok" : RED + "fail"}${RESET}  ${event.summary}`,
        );
        break;
      case "mcp_tool_call":
        console.log(
          `${CYAN}» ${event.server}.${event.name}${RESET} ${GRAY}${JSON.stringify(event.input).slice(0, 200)}${RESET}`,
        );
        break;
      case "mcp_tool_result":
        console.log(
          `  ${event.ok ? GREEN + "ok" : RED + "fail"}${RESET}  ${event.summary.slice(0, 240)}`,
        );
        break;
      case "signal_recorded":
        console.log(
          `${GREEN}[signal]${RESET} ${event.competitor} / ${event.signal_type} (${event.confidence.toFixed(2)}): ${event.summary}`,
        );
        break;
      case "done":
        console.log(
          `\n${GREEN}[done]${RESET} ${event.signals} signals in ${(event.duration_ms / 1000).toFixed(1)}s`,
        );
        break;
      case "error":
        console.log(`${RED}[error]${RESET} ${event.message}`);
        break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
