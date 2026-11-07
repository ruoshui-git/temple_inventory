import type { CapabilitySet } from "../services/contracts";

type Permission<T> = Extract<keyof T, string>;
export type CapabilityKey = {
  [
    Domain in keyof CapabilitySet & string
  ]: `${Domain}.${Permission<CapabilitySet[Domain]>}`;
}[keyof CapabilitySet & string];

export function can(
  capabilities: CapabilitySet | null | undefined,
  key: CapabilityKey,
) {
  if (!capabilities) return false;
  const [domain, permission] = key.split(".") as [keyof CapabilitySet, string];
  const permissions = capabilities[domain] as
    Record<string, boolean> | undefined;
  return permissions?.[permission] === true;
}

export function canOnDoctype(
  capabilities: CapabilitySet | null | undefined,
  doctype: string | undefined,
  permission: "write" | "delete",
) {
  const domain =
    doctype === "Stock Entry"
      ? "stock_entry"
      : doctype === "Stock Reconciliation"
        ? "stock_reconciliation"
        : null;
  return Boolean(domain && can(capabilities, `${domain}.${permission}`));
}

export function routeAllowed(
  requires: CapabilityKey | readonly CapabilityKey[] | undefined,
  capabilities: CapabilitySet | null | undefined,
) {
  return (
    !requires ||
    (Array.isArray(requires)
      ? requires.every((key) => can(capabilities, key))
      : can(capabilities, requires as CapabilityKey))
  );
}
