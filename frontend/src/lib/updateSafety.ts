import { computed, onBeforeUnmount, shallowReactive } from "vue";
const blockers = shallowReactive(new Map<symbol, () => boolean>());
export const updateBlocked = computed(() =>
  [...blockers.values()].some((blocked) => blocked()),
);
/** Editors own the meaning of unsaved input; the app only delays worker activation. */
export function useUpdateBlocker(blocked: () => boolean) {
  const owner = Symbol("pending-input");
  blockers.set(owner, blocked);
  onBeforeUnmount(() => blockers.delete(owner));
}
