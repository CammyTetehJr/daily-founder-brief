import { describe, expect, it } from "vitest";

import { isValidAudioFilename } from "./audio-filename";

describe("isValidAudioFilename", () => {
  it("accepts a UUID-named wav (production case)", () => {
    expect(isValidAudioFilename("98a91fe6-746c-4e6f-94d0-0601e300dfc6.wav")).toBe(
      true,
    );
  });

  it("accepts simple alphanumeric filenames with .wav extension", () => {
    expect(isValidAudioFilename("test.wav")).toBe(true);
    expect(isValidAudioFilename("brief123.wav")).toBe(true);
    expect(isValidAudioFilename("a.wav")).toBe(true);
  });

  it("accepts filenames containing hyphens and underscores", () => {
    expect(isValidAudioFilename("morning-brief.wav")).toBe(true);
    expect(isValidAudioFilename("morning_brief.wav")).toBe(true);
  });

  it("rejects path traversal attempts", () => {
    expect(isValidAudioFilename("../etc/passwd.wav")).toBe(false);
    expect(isValidAudioFilename("..wav")).toBe(false);
    expect(isValidAudioFilename("../foo.wav")).toBe(false);
    expect(isValidAudioFilename("foo/../bar.wav")).toBe(false);
  });

  it("rejects forward and back slashes", () => {
    expect(isValidAudioFilename("foo/bar.wav")).toBe(false);
    expect(isValidAudioFilename("foo\\bar.wav")).toBe(false);
    expect(isValidAudioFilename("/abs/path.wav")).toBe(false);
  });

  it("rejects non-wav extensions", () => {
    expect(isValidAudioFilename("foo.mp3")).toBe(false);
    expect(isValidAudioFilename("foo.txt")).toBe(false);
    expect(isValidAudioFilename("foo.png")).toBe(false);
    expect(isValidAudioFilename("foo")).toBe(false);
  });

  it("rejects leading-dot (hidden) filenames", () => {
    expect(isValidAudioFilename(".wav")).toBe(false);
    expect(isValidAudioFilename(".secret.wav")).toBe(false);
  });

  it("rejects empty string and missing input", () => {
    expect(isValidAudioFilename("")).toBe(false);
    expect(isValidAudioFilename(undefined)).toBe(false);
    expect(isValidAudioFilename(null)).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidAudioFilename(42)).toBe(false);
    expect(isValidAudioFilename({})).toBe(false);
    expect(isValidAudioFilename([])).toBe(false);
  });

  it("rejects null bytes and control characters", () => {
    expect(isValidAudioFilename("foo\x00.wav")).toBe(false);
    expect(isValidAudioFilename("foo\n.wav")).toBe(false);
    expect(isValidAudioFilename("foo bar.wav")).toBe(false);
  });

  it("rejects shell metacharacters and command injection patterns", () => {
    expect(isValidAudioFilename("foo;rm -rf.wav")).toBe(false);
    expect(isValidAudioFilename("$(whoami).wav")).toBe(false);
    expect(isValidAudioFilename("`id`.wav")).toBe(false);
    expect(isValidAudioFilename("foo&bar.wav")).toBe(false);
    expect(isValidAudioFilename("foo|cat.wav")).toBe(false);
  });

  it("rejects extremely long filenames", () => {
    const huge = "a".repeat(201) + ".wav";
    expect(isValidAudioFilename(huge)).toBe(false);
  });

  it("rejects filenames with `..` substring even with valid wrapping characters", () => {
    expect(isValidAudioFilename("a..b.wav")).toBe(false);
    expect(isValidAudioFilename("foo..wav")).toBe(false);
  });

  it("rejects any filename with internal dots, including multi-extension attempts", () => {
    // Stricter than the original implementation: the body of the filename
    // (everything before .wav) must be plain alphanumerics + hyphens +
    // underscores. No internal dots.
    expect(isValidAudioFilename("foo.wav.bak")).toBe(false);
    expect(isValidAudioFilename("foo.exe.wav")).toBe(false);
    expect(isValidAudioFilename("a.b.wav")).toBe(false);
  });

  it("acts as a TypeScript type guard", () => {
    const input: unknown = "abc.wav";
    if (isValidAudioFilename(input)) {
      const checked: string = input;
      expect(checked.endsWith(".wav")).toBe(true);
    }
  });
});
