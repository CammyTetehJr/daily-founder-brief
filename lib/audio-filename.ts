/**
 * Validator for audio filenames served by /api/audio/[name].
 *
 * The route serves raw bytes from data/audio/<name>, so the filename must be
 * locked down to alphanumerics + a small set of safe punctuation, plus a
 * required `.wav` extension. Anything that could escape the data/audio/
 * directory (slashes, backslashes, leading-dot hidden files, dot-segments)
 * is rejected here so the route handler stays a one-liner.
 */
export const AUDIO_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.wav$/;

export function isValidAudioFilename(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("..")) return false;
  return AUDIO_FILENAME_RE.test(name);
}
