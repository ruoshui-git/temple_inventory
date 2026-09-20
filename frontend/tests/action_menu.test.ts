import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActiveFilterChips from '../src/components/ActiveFilterChips.vue'
import FloatingActionMenu from '../src/components/FloatingActionMenu.vue'

describe('browse action contracts', () => {
  it('keeps chip removal at the beginning and collapses overflow', async () => {
    const chips = Array.from({ length: 8 }, (_, index) => ({ key: 'warehouse', value: String(index), label: `位置${index}` }))
    const wrapper = mount(ActiveFilterChips, { props: { chips } })
    expect(wrapper.find('.filter-chip button').text()).toBe('×')
    expect(wrapper.find('.chip-overflow').text()).toContain('另有 2 项')
    await wrapper.find('.chip-overflow').trigger('click')
    expect(wrapper.findAll('.filter-chip')).toHaveLength(8)
    expect(wrapper.find('.chip-overflow').text()).toBe('收起')
  })

  it('does not start an action while closed and closes on Escape', async () => {
    const wrapper = mount(FloatingActionMenu, { props: { actions: [{ kind: 'Receive', label: '入库' }] } })
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.find('.action-fab').trigger('click')
    await wrapper.find('[role="menuitem"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['Receive']])
    await wrapper.find('.action-fab').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })
})
