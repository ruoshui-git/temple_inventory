import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { dismissToast, toast, toasts } from '../src/lib/toast'
import ToastHost from '../src/components/ToastHost.vue'

afterEach(() => {
  for (const item of [...toasts]) dismissToast(item.id)
  vi.useRealTimers()
})

describe('toast feedback', () => {
  it('uses the confirmed durations and suppresses duplicate messages', () => {
    vi.useFakeTimers()
    toast('已保存')
    toast('已保存')
    toast('请检查', 'warning')
    toast('提交失败', 'error')
    expect(toasts.map(item => item.duration)).toEqual([4000, 6000, 8000])
    vi.advanceTimersByTime(4000)
    expect(toasts.map(item => item.message)).toEqual(['请检查', '提交失败'])
  })

  it('renders toast messages under document.body', async () => {
    const wrapper = mount(ToastHost)
    toast('入库已完成')
    await nextTick()
    expect(document.body.textContent).toContain('入库已完成')
    wrapper.unmount()
  })
})
