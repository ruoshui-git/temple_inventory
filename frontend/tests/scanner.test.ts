import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { sessionExpired } from '../src/lib/api'
import Scanner from '../src/components/Scanner.vue'

const state = vi.hoisted(() => ({
  starts: [] as string[],
  stops: 0,
  callbacks: [] as ((value: string) => void)[],
  errors: [] as ((error: unknown) => void)[],
  startError: undefined as Error | undefined,
}))
vi.mock('../src/lib/scanner', () => ({
  cameraError: (error: any) => String(error?.message || error),
  ScannerService: class {
    engineId = (localStorage.getItem('temple_inventory.scanner_engine') as any) || 'frappe'
    get engineLabel() { return this.engineId === 'frappe' ? 'Frappe 内置' : 'ZXing-WASM' }
    async start(_container: HTMLElement, callback: (value: string) => void, onError: (error: unknown) => void) {
      if (state.startError) { const error = state.startError; state.startError = undefined; throw error }
      state.starts.push(this.engineId); state.callbacks.push(callback); state.errors.push(onError)
    }
    async stop() { state.stops++ }
    async selectEngine(id: any) { state.stops++; this.engineId = id; localStorage.setItem('temple_inventory.scanner_engine', id) }
  },
}))

beforeEach(() => {
  vi.clearAllMocks(); state.starts.length = 0; state.stops = 0; state.callbacks.length = 0; state.errors.length = 0; state.startError = undefined
  localStorage.clear(); sessionExpired.value = false
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
})

describe('Scanner component', () => {
  it('teleports modal presentation, traps focus, restores body scroll and opener, and stops on close', async () => {
    const opener = document.createElement('button'); opener.textContent = 'open'; document.body.append(opener); opener.focus()
    document.body.style.overflow = 'scroll'
    const wrapper = mount(Scanner, { props: { presentation: 'modal' } }); await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy(); expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.textContent).toContain('扫描条码')
    expect(document.body.style.overflow).toBe('hidden'); expect(document.activeElement?.textContent).toContain('关闭相机')
    await dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await (document.body.querySelector('.scanner-modal .toolbar button') as HTMLButtonElement).click(); await flushPromises()
    expect(state.stops).toBeGreaterThan(0); expect(document.body.style.overflow).toBe('scroll'); expect(document.activeElement).toBe(opener)
    wrapper.unmount(); opener.remove()
  })

  it('closes modal on Escape and backdrop click, while continuous stays nonmodal and pauses', async () => {
    const modal = mount(Scanner, { props: { presentation: 'modal' } }); await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flushPromises()
    expect(modal.emitted('close')).toHaveLength(1); modal.unmount()
    const continuous = mount(Scanner, { props: { presentation: 'continuous' } }); await flushPromises()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull(); expect(continuous.text()).toContain('连续扫码')
    await continuous.setProps({ paused: true }); await flushPromises(); expect(state.stops).toBeGreaterThan(0)
    continuous.unmount()
  })

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

  it('keeps manual entry available and reports an asynchronous error after switching engines', async () => {
    const wrapper = mount(Scanner); await flushPromises()
    await wrapper.find('.scanner-engine button').trigger('click'); await flushPromises()
    state.errors[1](new Error('camera lost')); await flushPromises()
    expect(wrapper.text()).toContain('camera lost')
    await wrapper.find('input').setValue('MANUAL-1'); await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('scan')).toContainEqual(['MANUAL-1'])
    wrapper.unmount()
  })

  it('shows an initial startup failure and retries without losing manual entry', async () => {
    state.startError = new Error('initial camera failure')
    const wrapper = mount(Scanner)
    await flushPromises()
    expect(wrapper.text()).toContain('initial camera failure')
    expect(wrapper.find('form').exists()).toBe(true)
    const retry = wrapper.findAll('button').find(button => button.text() === '重试相机')
    expect(retry).toBeDefined()
    await retry!.trigger('click')
    await flushPromises()
    expect(state.starts).toEqual(['frappe'])
    expect(wrapper.text()).not.toContain('initial camera failure')
    wrapper.unmount()
  })
})
