/** Shared error classification without importing production transport into fixtures. */
export function isUnavailableError(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const value = reason as { kind?: string; status?: number };
  return (
    [401, 403, 404].includes(Number(value.status)) ||
    [
      "PermissionError",
      "AuthenticationError",
      "CSRFTokenError",
      "DoesNotExistError",
    ].includes(value.kind || "")
  );
}
