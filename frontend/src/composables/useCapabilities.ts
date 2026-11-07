import { computed } from "vue";
import { useOptionalReferenceData } from "../services/contracts";
import { can, type CapabilityKey } from "../lib/capabilities";

export function useCapabilities() {
  const reference = useOptionalReferenceData();
  return {
    capabilities: computed(() => reference?.capabilities ?? null),
    roleLabel: computed(() => reference?.role_label ?? ""),
    can: (key: CapabilityKey) => can(reference?.capabilities, key),
  };
}
