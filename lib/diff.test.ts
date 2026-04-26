import { describe, expect, it } from "vitest";

import type { Scrape } from "./db";
import { diffScrapes } from "./diff";

function scrape(overrides: Partial<Scrape>): Scrape {
  return {
    id: "s-default",
    competitor_id: "c-default",
    source_type: "pricing",
    url: "https://example.com",
    content_hash: "h-default",
    raw_content: "",
    extracted_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("diffScrapes", () => {
  it("returns null when fewer than 2 scrapes", () => {
    expect(diffScrapes([])).toBeNull();
    expect(diffScrapes([scrape({ id: "a" })])).toBeNull();
  });

  it("returns changed=false when both content_hashes match", () => {
    const result = diffScrapes([
      scrape({ id: "newer", content_hash: "h-same", raw_content: "x" }),
      scrape({ id: "older", content_hash: "h-same", raw_content: "x" }),
    ]);
    expect(result).not.toBeNull();
    expect(result!.changed).toBe(false);
    expect(result!.addedLines).toEqual([]);
    expect(result!.removedLines).toEqual([]);
  });

  it("treats input as DESC-ordered: index 0 is after, index 1 is before", () => {
    const result = diffScrapes([
      scrape({ id: "newer", content_hash: "h-new", raw_content: "added line" }),
      scrape({ id: "older", content_hash: "h-old", raw_content: "removed line" }),
    ]);
    expect(result!.before.id).toBe("older");
    expect(result!.after.id).toBe("newer");
  });

  it("computes added and removed lines on real content changes", () => {
    const result = diffScrapes([
      scrape({
        id: "newer",
        content_hash: "h-new",
        raw_content: "shared\nadded\n",
      }),
      scrape({
        id: "older",
        content_hash: "h-old",
        raw_content: "shared\nremoved\n",
      }),
    ]);
    expect(result!.changed).toBe(true);
    expect(result!.addedLines).toContain("added");
    expect(result!.removedLines).toContain("removed");
    expect(result!.addedLines).not.toContain("shared");
  });

  it("filters out empty and whitespace-only diff lines", () => {
    const result = diffScrapes([
      scrape({
        id: "newer",
        content_hash: "h-new",
        raw_content: "real\n\n   \n",
      }),
      scrape({
        id: "older",
        content_hash: "h-old",
        raw_content: "different\n",
      }),
    ]);
    expect(result!.addedLines).toContain("real");
    expect(
      result!.addedLines.every((l) => l.trim().length > 0),
    ).toBe(true);
    expect(
      result!.removedLines.every((l) => l.trim().length > 0),
    ).toBe(true);
  });

  it("handles entire-document replacement", () => {
    const result = diffScrapes([
      scrape({ id: "newer", content_hash: "h-new", raw_content: "completely new content" }),
      scrape({ id: "older", content_hash: "h-old", raw_content: "old content" }),
    ]);
    expect(result!.changed).toBe(true);
    expect(result!.addedLines.length).toBeGreaterThan(0);
    expect(result!.removedLines.length).toBeGreaterThan(0);
  });

  it("preserves the full Scrape object on before/after, not just IDs", () => {
    const after = scrape({
      id: "newer",
      content_hash: "h-new",
      url: "https://newer.example/",
      raw_content: "new",
    });
    const before = scrape({
      id: "older",
      content_hash: "h-old",
      url: "https://older.example/",
      raw_content: "old",
    });
    const result = diffScrapes([after, before]);
    expect(result!.before.url).toBe("https://older.example/");
    expect(result!.after.url).toBe("https://newer.example/");
  });

  it("ignores anything beyond the first two scrapes", () => {
    const result = diffScrapes([
      scrape({ id: "1", content_hash: "h1", raw_content: "first" }),
      scrape({ id: "2", content_hash: "h2", raw_content: "second" }),
      scrape({ id: "3", content_hash: "h3", raw_content: "ignored" }),
    ]);
    expect(result!.after.id).toBe("1");
    expect(result!.before.id).toBe("2");
  });
});
