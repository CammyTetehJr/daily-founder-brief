import { describe, expect, it } from "vitest";

import type { ComposedBrief } from "./compose";
import { buildVoiceScript } from "./gradium";

const baseBrief: ComposedBrief = {
  subject_line: "test subject",
  headline: "Three real things hit overnight",
  threat_level: 6,
  opening:
    "Two pricing experiments and one funding rumour. Worth thirty seconds of attention before standup.",
  signal_bullets: [
    {
      competitor: "Grammarly",
      signal_type: "messaging",
      one_liner: "Grammarly leads AI search at thirty five percent.",
      receipt: "https://example.com/grammarly",
      confidence: 0.85,
    },
    {
      competitor: "Wordtune",
      signal_type: "news",
      one_liner: "AI21 in talks to sell to Nebius.",
      receipt: "peec://or_abc/brand/kw_def",
      confidence: 0.7,
    },
    {
      competitor: "QuillBot",
      signal_type: "messaging",
      one_liner: "QuillBot now sells AI Humanizer as a paid tier.",
      receipt: "scrape diff",
      confidence: 0.6,
    },
  ],
  what_it_means:
    "Distribution in AI search is the moat. Wordtune ownership is in flux, which is the kind of opening to act on this week.",
  actions: [
    "Draft a Wordtune-comparison page today.",
    "Add three more comparison listicles for AI to cite.",
    "Audit ToneSwap copy for pay-what-you-want anchoring.",
  ],
};

describe("buildVoiceScript", () => {
  it("includes the headline and threat level", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script).toContain("Three real things hit overnight");
    expect(script).toContain("Threat level 6 out of ten");
  });

  it("opens and closes with a recognizable greeting and sign-off", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script.toLowerCase()).toContain("good morning");
    expect(script.toLowerCase()).toContain("have a good morning");
  });

  it("caps to the top two signals by confidence", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script).toContain("Grammarly");
    expect(script).toContain("Wordtune");
    expect(script).not.toContain("QuillBot");
  });

  it("strips https URLs from anything that gets spoken", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script).not.toMatch(/https?:\/\//);
  });

  it("strips peec:// receipts from anything that gets spoken", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script).not.toMatch(/peec:\/\//);
  });

  it("keeps the script under the 1500-char hard cap", () => {
    const script = buildVoiceScript(baseBrief);
    expect(script.length).toBeLessThanOrEqual(1500);
  });

  it("handles a brief with zero signals without crashing", () => {
    const quiet: ComposedBrief = {
      ...baseBrief,
      signal_bullets: [],
      threat_level: 1,
      opening: "Quiet overnight.",
    };
    const script = buildVoiceScript(quiet);
    expect(script).toContain("0 signals today");
    expect(script).toContain("Quiet overnight.");
  });

  it("caps actions to the top three", () => {
    const many: ComposedBrief = {
      ...baseBrief,
      actions: ["A.", "B.", "C.", "D.", "E."],
    };
    const script = buildVoiceScript(many);
    expect(script).toContain("1. A.");
    expect(script).toContain("2. B.");
    expect(script).not.toContain("4. D.");
    expect(script).not.toContain("5. E.");
  });
});
