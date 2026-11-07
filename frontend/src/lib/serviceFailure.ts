/** Shared error classification without importing production transport into fixtures. */
export function isUnavailableError(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const value = reason as { kind?: string; status?: number };
  return (
    [401, 403, 404].includes(Number(value.status)) ||
    [
      "forbidden",
      "AuthenticationError",
      "CSRFTokenError",
      "DoesNotExistError",
    ].includes(value.kind || "")
  );
}

export function isForbiddenError(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const value = reason as { kind?: string; status?: number };
  return value.kind === "forbidden" || value.status === 403;
}
