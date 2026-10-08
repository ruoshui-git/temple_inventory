import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** The breakpoint shared by the application shell and every browse surface. */
export const RESPONSIVE_BREAKPOINT = 1024;
export const RESPONSIVE_MEDIA_QUERY = `(min-width: ${RESPONSIVE_BREAKPOINT}px)`;

export type ResponsiveSurface = "desktop" | "mobile";

export interface ResponsiveLayout {
  isDesktop: Ref<boolean>;
  isMobile: Readonly<Ref<boolean>>;
  surface: Readonly<Ref<ResponsiveSurface>>;
  isSurface: (surface: ResponsiveSurface) => boolean;
  breakpoint: number;
}

/**
 * Keep responsive branching in one place. The initial value is deliberately
 * mobile-first so SSR and no-DOM environments render a safe, compact tree.
 * The media-query listener is removed with the component that owns it.
 */
export function useResponsiveLayout(enabled = true): ResponsiveLayout {
  const isDesktop = ref(false);
  let mediaQuery: MediaQueryList | undefined;

  const update = (event?: MediaQueryListEvent | MediaQueryList) => {
    isDesktop.value = Boolean(event?.matches ?? mediaQuery?.matches);
  };

  onMounted(() => {
    if (!enabled) return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    mediaQuery = window.matchMedia(RESPONSIVE_MEDIA_QUERY);
    update(mediaQuery);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
    } else {
      mediaQuery.addListener(update);
    }
  });

  onBeforeUnmount(() => {
    if (!enabled) return;
    if (!mediaQuery) return;
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", update);
    } else {
      mediaQuery.removeListener(update);
    }
    mediaQuery = undefined;
  });

  const isSurface = (requested: ResponsiveSurface) => {
    const matches =
      mediaQuery?.matches ??
      (typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(RESPONSIVE_MEDIA_QUERY).matches
        : isDesktop.value);
    return requested === (matches ? "desktop" : "mobile");
  };

  return {
    isDesktop,
    isMobile: computed(() => !isDesktop.value),
    surface: computed(() => (isDesktop.value ? "desktop" : "mobile")),
    isSurface,
    breakpoint: RESPONSIVE_BREAKPOINT,
  };
}
