import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HierarchyAutocomplete from '../src/components/HierarchyAutocomplete.vue'

describe('HierarchyAutocomplete', () => {
  it('does not preselect a group whose only leaf is hidden from the option list', async () => {
    const tree = [
      { name: 'site', label: '第2寺院', is_group: 1, lft: 1, rgt: 6 },
      { name: 'room', label: 'A02', parent_warehouse: 'site', is_group: 1, lft: 2, rgt: 5 },
      { name: 'fallback', label: '无货位', parent_warehouse: 'room', is_group: 0, lft: 3, rgt: 4 },
    ]
    const wrapper = mount(HierarchyAutocomplete, {
      props: { modelValue: [], options: tree.slice(0, 2), tree, title: '仓库 / 位置', placeholder: '搜索' },
    })

    await wrapper.get('button[aria-label="浏览选项"]').trigger('click')
    await wrapper.get('.tree-toggle').trigger('click')
    const room = wrapper.findAll('input[type="checkbox"]')[1]
    expect((room.element as HTMLInputElement).checked).toBe(false)
    await room.trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[['room']]])
  })
})
