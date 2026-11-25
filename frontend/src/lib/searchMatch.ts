export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesWords(query: string, text: string): boolean {
  const term = normalizeSearch(query);
  if (!term) return true;
  const content = normalizeSearch(text);
  return (
    content.includes(term) ||
    term.split(" ").every((word) => content.includes(word))
  );
}
