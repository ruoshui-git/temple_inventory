/** Normalize an input's hour width while preserving native second precision. */
export function postingTime(value: unknown) {
  const text = String(value || "");
  return text.replace(/^(\d):/, "0$1:");
}
