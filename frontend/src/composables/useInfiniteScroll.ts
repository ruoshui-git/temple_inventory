import { onBeforeUnmount, ref, type Ref } from "vue";

export interface ListSurfaceHandle {
  root: Ref<HTMLElement | null | undefined>;
  sentinel: Ref<HTMLElement | null | undefined>;
  connect: (root?: HTMLElement | null, sentinel?: HTMLElement | null) => void;
  disconnect: () => void;
}

export interface InfiniteScrollOptions {
  hasMore: () => boolean;
  isLoading: () => boolean;
  onLoadMore: () => void | Promise<void>;
  rootMargin?: string;
}

/**
 * Own the observer at the presentation boundary. A controller only decides
 * whether another page exists; the active desktop/mobile view supplies the
 * scroll root and sentinel that are actually mounted.
 */
export function useInfiniteScroll(
  options: InfiniteScrollOptions,
): ListSurfaceHandle {
  const root = ref<HTMLElement | null>();
  const sentinel = ref<HTMLElement | null>();
  let observer: IntersectionObserver | undefined;

  function disconnect() {
    observer?.disconnect();
    observer = undefined;
  }

  function connect(
    nextRoot: HTMLElement | null = null,
    nextSentinel: HTMLElement | null = null,
  ) {
    disconnect();
    root.value = nextRoot;
    sentinel.value = nextSentinel;
    if (typeof IntersectionObserver === "undefined" || !nextSentinel) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          options.hasMore() &&
          !options.isLoading()
        ) {
          void options.onLoadMore();
        }
      },
      { root: nextRoot, rootMargin: options.rootMargin || "240px" },
    );
    observer.observe(nextSentinel);
  }

  onBeforeUnmount(disconnect);

  return { root, sentinel, connect, disconnect };
}
