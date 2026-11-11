import { useRouter, type RouteLocationRaw } from "vue-router";

export function useBackNavigation() {
  const router = useRouter();

  function goBack(
    fallback: RouteLocationRaw,
    options: { preserveOverlay?: boolean } = {},
  ) {
    const state = window.history.state as {
      back?: unknown;
      tiOverlay?: unknown;
    } | null;
    if (state?.back !== undefined && state.back !== null) {
      if (options.preserveOverlay && state.tiOverlay) window.history.go(-2);
      else void router.back();
      return;
    }
    void router.replace(fallback);
  }

  return { goBack };
}
