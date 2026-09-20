import { afterEach, describe, expect, it, vi } from 'vitest'
import { hydrateFilterQuery, serializeFilterQuery, useDebouncedRequest } from '../src/composables/filters'

afterEach(() => {
  vi.useRealTimers()
})

describe('filter query state', () => {
  it('uses repeated values without punctuation splitting', () => {
    const query = serializeFilterQuery({
      warehouses: ['Room / A, east', 'Room / B'],
      item_groups: ['Food, dry'],
      search: 'rice',
    })
    expect(query).toEqual({
      warehouses: ['Room / A, east', 'Room / B'],
      item_groups: ['Food, dry'],
      search: 'rice',
    })
    expect(hydrateFilterQuery(query, { warehouses: [] as string[], item_groups: [] as string[], search: '' })).toEqual({
      warehouses: ['Room / A, east', 'Room / B'],
      item_groups: ['Food, dry'],
      search: 'rice',
    })
  })

  it('keeps defaults for absent scalar values and treats empty arrays as all', () => {
    expect(hydrateFilterQuery({}, { warehouses: [] as string[], sort: 'asc', start: '0' })).toEqual({
      warehouses: [],
      sort: 'asc',
      start: '0',
    })
    expect(serializeFilterQuery({ warehouses: [], start: undefined })).toEqual({})
  })
})

describe('debounced requests', () => {
  it('aborts stale requests and only accepts the newest response', async () => {
    vi.useFakeTimers()
    const calls: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => {
      calls.push(signal)
      return new Promise<string>(resolve => {
        signal.addEventListener('abort', () => resolve('stale'))
        setTimeout(() => resolve(calls.length === 1 ? 'old' : 'new'), calls.length === 1 ? 100 : 10)
      })
    })
    const request = useDebouncedRequest(load, 300)
    const first = request.run()
    await vi.advanceTimersByTimeAsync(300)
    const second = request.run()
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(20)
    expect(calls[0].aborted).toBe(true)
    expect(await first).toBeUndefined()
    expect(await second).toBe('new')
  })
})
