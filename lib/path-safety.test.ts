import { describe, expect, it } from "vitest";

import { safePathSegment } from "./path-safety";

describe("safePathSegment", () => {
  it("accepts a UUID", () => {
    const id = "41449dbf-8d94-4ae9-89f8-98646de8f89a";
    expect(safePathSegment(id, "test")).toBe(id);
  });

  it("accepts an enum-style source_type", () => {
    expect(safePathSegment("pricing", "sourceType")).toBe("pricing");
    expect(safePathSegment("careers", "sourceType")).toBe("careers");
    expect(safePathSegment("homepage", "sourceType")).toBe("homepage");
  });

  it("accepts an ISO timestamp with hyphen substitutions", () => {
    const ts = "2026-04-25T17-00-13-619Z";
    expect(safePathSegment(ts, "timestamp")).toBe(ts);
  });

  it("rejects path traversal", () => {
    expect(() => safePathSegment("..", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("../etc/passwd", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("foo/../bar", "x")).toThrow(/unsafe/);
  });

  it("rejects forward and back slashes", () => {
    expect(() => safePathSegment("a/b", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("a\\b", "x")).toThrow(/unsafe/);
  });

  it("rejects leading dots and the literal . segment", () => {
    expect(() => safePathSegment(".", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment(".env", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment(".hidden", "x")).toThrow(/unsafe/);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(() => safePathSegment("", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment(" ", "x")).toThrow(/unsafe/);
  });

  it("rejects null bytes and control characters", () => {
    expect(() => safePathSegment("foo\x00bar", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("foo\nbar", "x")).toThrow(/unsafe/);
  });

  it("rejects shell metacharacters", () => {
    expect(() => safePathSegment("a;b", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("$(whoami)", "x")).toThrow(/unsafe/);
    expect(() => safePathSegment("a&b", "x")).toThrow(/unsafe/);
  });

  it("rejects values longer than 200 characters", () => {
    const huge = "a".repeat(201);
    expect(() => safePathSegment(huge, "x")).toThrow(/unsafe/);
  });

  it("rejects non-string input", () => {
    expect(() => safePathSegment(undefined as unknown as string, "x")).toThrow(
      /unsafe/,
    );
    expect(() => safePathSegment(null as unknown as string, "x")).toThrow(
      /unsafe/,
    );
    expect(() => safePathSegment(42 as unknown as string, "x")).toThrow(
      /unsafe/,
    );
  });

  it("includes the label in the error message", () => {
    expect(() => safePathSegment("../bad", "competitorId")).toThrow(
      /competitorId/,
    );
  });
});
