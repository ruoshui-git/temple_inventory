import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { sessionExpired } from '../src/lib/api'
import Scanner from '../src/components/Scanner.vue'

const state = vi.hoisted(() => ({ starts: [] as string[], stops: 0, callbacks: [] as ((value: string) => void)[] }))
vi.mock('../src/lib/scanner', () => ({
  cameraError: (error: any) => String(error?.message || error),
  ScannerService: class {
    engineId = (localStorage.getItem('temple_inventory.scanner_engine') as any) || 'frappe'
    get engineLabel() { return this.engineId === 'frappe' ? 'Frappe 内置' : 'ZXing-WASM' }
    async start(_container: HTMLElement, callback: (value: string) => void) { state.starts.push(this.engineId); state.callbacks.push(callback) }
    async stop() { state.stops++ }
    async selectEngine(id: any) { state.stops++; this.engineId = id; localStorage.setItem('temple_inventory.scanner_engine', id) }
  },
}))

beforeEach(() => {
  vi.clearAllMocks(); state.starts.length = 0; state.stops = 0; state.callbacks.length = 0
  localStorage.clear(); sessionExpired.value = false
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
})

describe('Scanner component', () => {
  it('defaults to Frappe, renders the opposite engine, and suppresses duplicates for both engines', async () => {
    const wrapper = mount(Scanner); await flushPromises()
    expect(wrapper.text()).toContain('扫描引擎：Frappe 内置')
    expect(wrapper.text()).toContain('切换到 ZXing-WASM')
    state.callbacks[0]('123'); state.callbacks[0]('123'); expect(wrapper.emitted('scan')).toEqual([['123']])
    await wrapper.find('.scanner-engine button').trigger('click'); await flushPromises()
    expect(state.starts).toEqual(['frappe', 'zxing-wasm']); expect(state.stops).toBe(1)
    expect(wrapper.text()).toContain('切换到 Frappe 内置')
    state.callbacks[1]('123'); expect(wrapper.emitted('scan')).toHaveLength(1)
    wrapper.unmount(); await flushPromises(); expect(state.stops).toBe(2)
  })

  it('persists engine choice, rejects invalid preferences, and keeps manual entry usable', async () => {
    localStorage.setItem('temple_inventory.scanner_engine', 'invalid')
    const wrapper = mount(Scanner); await flushPromises(); expect(wrapper.text()).toContain('Frappe 内置')
    await wrapper.find('.scanner-engine button').trigger('click'); await flushPromises(); wrapper.unmount()
    const remounted = mount(Scanner); await flushPromises(); expect(remounted.text()).toContain('ZXing-WASM')
    await remounted.find('input').setValue('A001'); await remounted.find('form').trigger('submit')
    expect(remounted.emitted('scan')).toEqual([['A001']]); remounted.unmount()
  })

  it('stops on pause, session expiry, close, and unmount, then restarts after recovery', async () => {
    const wrapper = mount(Scanner); await flushPromises(); const initialStarts = state.starts.length
    await wrapper.setProps({ paused: true }); await flushPromises(); expect(state.stops).toBe(1)
    await wrapper.setProps({ paused: false }); await flushPromises(); expect(state.starts.length).toBe(initialStarts + 1)
    sessionExpired.value = true; await flushPromises(); expect(state.stops).toBeGreaterThanOrEqual(2)
    sessionExpired.value = false; await flushPromises(); expect(state.starts.length).toBe(initialStarts + 2)
    await wrapper.find('.toolbar button').trigger('click'); await flushPromises(); expect(state.stops).toBe(3)
    wrapper.unmount(); await flushPromises(); expect(state.stops).toBe(4)
  })
})
