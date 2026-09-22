import { beforeEach, describe, expect, it, vi } from 'vitest'
import { returnToOpener } from '../src/lib/navigation'

const router = () => ({ back: vi.fn(() => Promise.resolve()), replace: vi.fn(() => Promise.resolve()) })

beforeEach(() => {
  window.history.replaceState({}, '', '/inventory/item/A001')
})

describe('returnToOpener', () => {
  it('uses a same-origin in-app history predecessor', async () => {
    const current = router()
    window.history.replaceState({ back: '/inventory?mode=current' }, '', '/inventory/item/A001')
    await returnToOpener(current as any, '/inventory')
    expect(current.back).toHaveBeenCalledOnce()
    expect(current.replace).not.toHaveBeenCalled()
  })

  it('replaces direct entry and rejects malformed or external history', async () => {
    for (const back of ['https://example.com/inventory', 'not a url']) {
      const current = router()
      window.history.replaceState({ back }, '', '/inventory/item/A001')
      await returnToOpener(current as any, { path: '/inventory', query: { mode: 'current' } })
      expect(current.replace).toHaveBeenCalledWith({ path: '/inventory', query: { mode: 'current' } })
      expect(current.back).not.toHaveBeenCalled()
    }
  })
})
