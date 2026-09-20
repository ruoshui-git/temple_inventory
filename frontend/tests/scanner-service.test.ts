import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScannerService, type ScannerEngine } from '../src/lib/scanner'

function engine(id: ScannerEngine['id'], label = id) {
  return { id, label, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) } satisfies ScannerEngine
}

beforeEach(() => localStorage.clear())

describe('ScannerService', () => {
  it('defaults to Frappe, validates persisted choices, and persists deliberate switches', async () => {
    const frappe = engine('frappe', 'Frappe 内置'); const wasm = engine('zxing-wasm', 'ZXing-WASM')
    const service = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    expect(service.engineId).toBe('frappe'); expect(service.engineLabel).toBe('Frappe 内置')
    await service.selectEngine('zxing-wasm'); expect(service.engineId).toBe('zxing-wasm')
    expect(localStorage.getItem('temple_inventory.scanner_engine')).toBe('zxing-wasm')
    const restored = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    expect(restored.engineId).toBe('zxing-wasm')
    localStorage.setItem('temple_inventory.scanner_engine', 'other')
    expect(new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm }).engineId).toBe('frappe')
  })

  it('stops the old engine before starting a switched engine and serializes operations', async () => {
    const frappe = engine('frappe'); const wasm = engine('zxing-wasm'); const order: string[] = []
    frappe.start.mockImplementation(async () => { order.push('frappe start') })
    frappe.stop.mockImplementation(async () => { order.push('frappe stop') })
    wasm.start.mockImplementation(async () => { order.push('wasm start') })
    const service = new ScannerService({ frappe: () => frappe, 'zxing-wasm': () => wasm })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    await service.start(document.createElement('div'), vi.fn()); await service.selectEngine('zxing-wasm'); await service.start(document.createElement('div'), vi.fn())
    expect(order).toEqual(['frappe start', 'frappe stop', 'wasm start'])
  })

  it('leaves manual callers usable when an engine fails and cleans up the failed engine', async () => {
    const failing = engine('frappe'); failing.start.mockRejectedValue(new Error('load failed'))
    const service = new ScannerService({ frappe: () => failing, 'zxing-wasm': () => engine('zxing-wasm') })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    await expect(service.start(document.createElement('div'), vi.fn())).rejects.toThrow('load failed')
    expect(failing.stop).toHaveBeenCalledOnce()
  })
})
