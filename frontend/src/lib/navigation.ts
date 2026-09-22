import type { RouteLocationRaw, Router } from 'vue-router'

export function returnToOpener(router: Router, fallback: RouteLocationRaw): Promise<void> | void {
  try {
    if (typeof window !== 'undefined') {
      const back = window.history.state?.back
      if (typeof back === 'string') {
        const previous = new URL(back, window.location.origin)
        const base = new URL('/inventory', window.location.origin)
        const path = previous.pathname.replace(/\/+$/, '') || '/'
        const basePath = base.pathname.replace(/\/+$/, '') || '/'
        if (previous.origin === window.location.origin && (path === basePath || path.startsWith(`${basePath}/`))) {
          return Promise.resolve(router.back()).then(() => undefined)
        }
      }
    }
  } catch { /* malformed history is treated as direct entry */ }
  return Promise.resolve(router.replace(fallback)).then(() => undefined)
}