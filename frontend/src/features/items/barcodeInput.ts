export function appendBarcode(existing: string, scanned: string): string {
  const barcode = scanned.trim();
  if (!barcode) return existing;
  if (existing.split(/\r?\n/).some((value) => value.trim() === barcode))
    return existing;
  const separator =
    existing && !existing.endsWith("\n") && !existing.endsWith("\r")
      ? "\n"
      : "";
  return `${existing}${separator}${barcode}`;
}
