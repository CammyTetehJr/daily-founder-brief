/**
 * Validates a string before using it as a path segment.
 *
 * The allowed character set covers UUIDs, ISO timestamps with hyphen
 * substitutions, and our enum source_type values. Anything else throws -
 * this is intentional defense in depth even though our callers already
 * pass values from trusted sources (DB UUIDs, enum-validated strings).
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function safePathSegment(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    !SAFE_SEGMENT.test(value) ||
    value === "." ||
    value === ".." ||
    value.startsWith(".") ||
    value.includes("..")
  ) {
    throw new Error(
      `unsafe path segment for ${label}: ${String(value).slice(0, 80)}`,
    );
  }
  return value;
}
