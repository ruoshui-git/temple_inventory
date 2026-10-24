export function loanReferenceIdentity(
  borrower: unknown,
  date: unknown,
): string {
  const name = String(borrower || "").trim();
  const postingDate = String(date || "").trim();
  const shortDate = /^\d{4}-\d{2}-\d{2}/.test(postingDate)
    ? postingDate.slice(5, 10)
    : postingDate;
  return [name, shortDate].filter(Boolean).join(" · ");
}
