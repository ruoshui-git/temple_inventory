import { ref } from 'vue'

export type FilterQuery = Record<string, unknown>

/** Vue Router may give us either one query value or a repeated array value. */
export function queryValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(queryValues)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

/** Keep arrays as repeated query values; names are never split on punctuation. */
export function serializeFilterQuery(filters: FilterQuery): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      const values = value.filter(item => item !== undefined && item !== null && item !== '').map(String)
      if (values.length) result[key] = values
      continue
    }
    if (value !== undefined && value !== null && value !== '') result[key] = String(value)
  }
  return result
}

export function hydrateFilterQuery<T extends FilterQuery>(query: FilterQuery, defaults: T): T {
  const result = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const values = queryValues(query[key])
    ;(result as FilterQuery)[key] = Array.isArray(defaults[key]) ? values : (values[0] ?? defaults[key])
  }
  return result
}

export function sameFilterValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left.map(String) : [String(left)]
    const b = Array.isArray(right) ? right.map(String) : [String(right)]
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
  return String(left ?? '') === String(right ?? '')
}

/**
 * Debounce text-driven requests and cancel/ignore older requests. The current
 * result can remain visible while `refreshing` is true.
 */
export function useDebouncedRequest<T>(
  load: (signal: AbortSignal) => Promise<T>,
  delay = 300,
) {
  const initialLoading = ref(true)
  const refreshing = ref(false)
  const error = ref('')
  const success = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let sequence = 0
  let cancelPending: (() => void) | undefined

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = undefined
    cancelPending?.()
    cancelPending = undefined
  }

  async function execute(current: number): Promise<T | undefined> {
    controller?.abort()
    controller = new AbortController()
    const activeController = controller
    refreshing.value = true
    error.value = ''
    try {
      const value = await load(activeController.signal)
      if (current !== sequence) return undefined
      success.value = true
      return value
    } catch (cause: any) {
      if (current === sequence && cause?.name !== 'AbortError') error.value = cause?.message || '加载失败'
      return undefined
    } finally {
      if (current === sequence) {
        initialLoading.value = false
        refreshing.value = false
      }
    }
  }

  function run(debounce = true): Promise<T | undefined> {
    cancel()
    const current = ++sequence
    if (!debounce) return execute(current)
    return new Promise(resolve => {
      let settled = false
      const settle = (value: T | undefined) => {
        if (settled) return
        settled = true
        if (cancelPending === cancelCurrent) cancelPending = undefined
        resolve(value)
      }
      const cancelCurrent = () => settle(undefined)
      cancelPending = cancelCurrent
      timer = setTimeout(() => {
        timer = undefined
        void execute(current).then(settle)
      }, delay)
    })
  }

  return { initialLoading, refreshing, error, success, run, cancel }
}
