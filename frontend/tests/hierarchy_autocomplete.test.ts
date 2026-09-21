import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WarehouseSelector from '../src/components/WarehouseSelector.vue'
import CategorySelector from '../src/components/CategorySelector.vue'

describe('WarehouseSelector', () => {
  it('does not preselect a group whose only leaf is hidden from the option list', async () => {
    const tree = [
      { name: 'site', label: '第2寺院', is_group: 1, lft: 1, rgt: 6 },
      { name: 'room', label: 'A02', parent_warehouse: 'site', is_group: 1, lft: 2, rgt: 5 },
      { name: 'fallback', warehouse_name: 'A02 / 未指定', fallback_role: 'room_default', parent_warehouse: 'room', is_group: 0, lft: 3, rgt: 4 },
    ]
    const wrapper = mount(WarehouseSelector, {
      props: { modelValue: [], rows: tree, placeholder: '搜索' },
    })

    await wrapper.get('button[aria-label="浏览选项"]').trigger('click')
    await wrapper.get('.tree-toggle').trigger('click')
    const room = wrapper.findAll('input[type="checkbox"]')[1]
    expect((room.element as HTMLInputElement).checked).toBe(false)
    await room.trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[['room']]])
  })

  it('uses presenter labels rather than ERPNext company-suffixed identifiers in chips', () => {
    const rows = [
      { name: '第2寺院 - O', warehouse_name: '第2寺院', is_group: 1, lft: 1, rgt: 4 },
      { name: 'A02 - O', warehouse_name: 'A02', parent_warehouse: '第2寺院 - O', is_group: 1, lft: 2, rgt: 3 },
    ]
    const wrapper = mount(WarehouseSelector, { props: { modelValue: ['A02 - O'], rows } })
    expect(wrapper.text()).toContain('第2寺院 / A02')
    expect(wrapper.text()).not.toContain(' - O')
  })

  it('hides only explicitly zero-count warehouse and category options', async () => {
    const warehouses = [
      { name: 'used', warehouse_name: 'A02', is_group: 0, lft: 1, rgt: 2 },
      { name: 'empty', warehouse_name: 'A04', is_group: 0, lft: 3, rgt: 4 },
    ]
    const warehouse = mount(WarehouseSelector, { props: { modelValue: [], rows: warehouses, counts: { used: 2, empty: 0 } } })
    await warehouse.get('button[aria-label="浏览选项"]').trigger('click')
    expect(warehouse.text()).toContain('A02')
    expect(warehouse.text()).not.toContain('A04')

    const category = mount(CategorySelector, { props: { modelValue: [], rows: [
      { name: 'All Item Groups', item_group_name: 'All Item Groups', is_group: 1, lft: 1, rgt: 6 },
      { name: 'used', item_group_name: '常用', parent_item_group: 'All Item Groups', lft: 2, rgt: 3 },
      { name: 'empty', item_group_name: '空类别', parent_item_group: 'All Item Groups', lft: 4, rgt: 5 },
    ], counts: { used: 1, empty: 0 } } })
    await category.get('button[aria-label="浏览选项"]').trigger('click')
    expect(category.text()).toContain('常用')
    expect(category.text()).toContain('1')
    expect(category.text()).not.toContain('空类别')
  })
})
