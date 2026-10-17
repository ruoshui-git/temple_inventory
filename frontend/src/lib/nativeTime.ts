/** Normalize an input's hour width while preserving native second precision. */
export function postingTime(value: unknown) {
  const text = String(value || "");
  return text.replace(/^(\d):/, "0$1:");
}

/** Native timestamps are site wall time: never reinterpret them in browser UTC/local time.
 * This is display-only; callers retain exact version and modification tokens.
 */
export function siteDateTime(value: unknown): string {
  const text = String(value || "");
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(
      text,
    );
  return match ? `${match[1]} ${match[2]!.padStart(2, "0")}:${match[3]}` : text;
}
