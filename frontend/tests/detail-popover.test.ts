import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DetailPopover from '../src/components/DetailPopover.vue'

describe('DetailPopover', () => {
  afterEach(() => document.body.querySelectorAll('.detail-popover-content').forEach(node => node.remove()))

  it('renders details in a body-level overlay without changing the table cell layout', async () => {
    const wrapper = mount(DetailPopover, {
      attachTo: document.body,
      props: { label: '查看 2 个类别', triggerText: '2' },
      slots: { default: '食品：3 行' },
    })

    await wrapper.get('button').trigger('mouseenter')

    expect(wrapper.find('.detail-popover-content').exists()).toBe(false)
    expect(document.body.querySelector('.detail-popover-content')?.textContent).toContain('食品：3 行')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('pins on click and closes on Escape', async () => {
    const wrapper = mount(DetailPopover, {
      attachTo: document.body,
      props: { label: '查看位置', triggerText: '1' },
      slots: { default: '主仓库' },
    })

    await wrapper.get('button').trigger('click')
    expect(document.body.querySelector('.detail-popover-content')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.detail-popover-content')).toBeNull()
    wrapper.unmount()
  })
})
