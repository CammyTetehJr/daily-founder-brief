import { randomUUID } from "node:crypto";

import type { ComposedBrief } from "../lib/compose";
import { buildVoiceScript, generateVoiceBrief } from "../lib/gradium";

const SAMPLE: ComposedBrief = {
  subject_line: "Jasper ships Brand Compliance Diagnostic, doubles down on agentic marketing",
  headline: "Jasper sharpens its enterprise brand-safety pitch",
  threat_level: 4,
  opening:
    "Jasper just shipped a Brand Compliance Diagnostic that scans a customer site and scores their brand governance. It is a clean enterprise wedge and it overlaps directly with the tone-consistency story ToneSwap tells.",
  signal_bullets: [
    {
      competitor: "Jasper",
      signal_type: "feature",
      one_liner:
        "Brand Compliance Diagnostic launched, scoring brand governance for enterprise customers.",
      receipt: "scrape diff",
      confidence: 0.75,
    },
  ],
  what_it_means:
    "Jasper is climbing the enterprise stack. ToneSwap has 90 days to either own the SMB tone-consistency story or build a credible enterprise brand-safety angle of its own.",
  actions: [
    "Draft a positioning page contrasting ToneSwap's user-owned voice with Jasper's enterprise governance pitch.",
    "Talk to two enterprise design buyers this week about their brand-safety pain points.",
    "Decide by end of week whether to chase the same enterprise buyer or stay focused on indie founders.",
  ],
};

async function main() {
  const briefId = process.argv[2] ?? `test-${randomUUID().slice(0, 8)}`;

  const script = buildVoiceScript(SAMPLE);
  console.log(`brief id: ${briefId}`);
  console.log(`script:   ${script.length} chars\n`);
  console.log("--- SCRIPT ---");
  console.log(script);
  console.log("--------------\n");

  const t0 = Date.now();
  console.log("calling Gradium TTS...");
  const result = await generateVoiceBrief({ brief: SAMPLE, briefId });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nok in ${elapsed}s`);
  console.log(`  size:     ${Math.round(result.bytes / 1024)} KB`);
  console.log(`  duration: ~${result.durationApproxSeconds.toFixed(1)}s`);
  console.log(`  path:     ${result.path}`);
  console.log(`\nplay it:`);
  console.log(`  open ${result.path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
