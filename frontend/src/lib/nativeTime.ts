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

/** Convert a timezone-free site wall-time string to an epoch using the site timezone. */
export function siteWallTimestamp(value: unknown, timezone: string): number {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      String(value || ""),
    );
  if (!match || !timezone)
    return Date.parse(String(value || "").replace(" ", "T"));
  const [, year, month, day, hour, minute, second = "0"] = match;
  const desired = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    let guess = desired;
    for (let attempt = 0; attempt < 2; attempt++) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(guess))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      );
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
      guess += desired - represented;
    }
    return guess;
  } catch {
    return Date.parse(String(value || "").replace(" ", "T"));
  }
}
