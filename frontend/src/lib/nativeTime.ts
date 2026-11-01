/** Normalize an input's hour width while preserving native second precision. */
export function postingTime(value: unknown) {
  return formatSiteTime(value) || "00:00:00";
}

/** Native timestamps are site wall time: never reinterpret them in browser UTC/local time.
 * This is display-only; callers retain exact version and modification tokens.
 */
export function formatSiteTime(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
    String(value || ""),
  );
  return match
    ? `${match[1]!.padStart(2, "0")}:${match[2]}:${match[3] || "00"}`
    : "";
}

export function formatSiteDateTime(value: unknown, timezone = ""): string {
  const text = String(value || "");
  if (timezone && /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const instant = new Date(text);
    if (!Number.isNaN(instant.getTime())) {
      try {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          })
            .formatToParts(instant)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value]),
        );
        return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
      } catch {
        return "";
      }
    }
  }
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      text,
    );
  return match
    ? `${match[1]} ${match[2]!.padStart(2, "0")}:${match[3]}:${match[4] || "00"}`
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text
      : "";
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
import { getCurrentInstance } from "vue";
import { useOptionalReferenceData } from "../services/contracts";

export function relativeTime(value: string, now?: number) {
  const timezone = getCurrentInstance()
    ? (useOptionalReferenceData()?.timezone ?? "")
    : "";
  const stamp = siteWallTimestamp(value, timezone);
  now ??= Date.now();
  const minutes = Math.max(0, Math.floor((now - stamp) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
