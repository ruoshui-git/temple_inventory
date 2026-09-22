import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import SortableDataTable, { type DataTableColumn } from '../src/components/SortableDataTable.vue'

const columns: DataTableColumn[] = [
  { key: 'name', label: '名称', sortable: true, initialOrder: 'desc' },
  { key: 'status', label: '状态', sortable: true },
]
const rows = [{ id: '1', name: '一号', status: '开放' }]
const mountTable = (selectionMode = false) => mount(SortableDataTable, {
  props: { rows, columns, rowKey: 'id', sort: { sort_by: 'status', sort_order: 'asc' }, selectionMode },
  slots: {
    'cell-name': ({ row }: any) => h('a', { 'data-row-action': true, href: `/item/${row.id}` }, row.name),
    'cell-status': () => h('button', { 'data-row-control': true }, '按钮'),
    'mobile-row': ({ row }: any) => h('article', { tabindex: 0 }, [h('a', { 'data-row-action': true, href: `/item/${row.id}` }, row.name), h('button', { 'data-row-control': true }, '按钮')]),
  },
})

describe('SortableDataTable', () => {
  it('emits initial order, reverses active order, and exposes aria sort and arrows', async () => {
    const wrapper = mountTable()
    const headers = wrapper.findAll('th')
    await headers[0].find('button').trigger('click')
    expect(wrapper.emitted('sort')?.[0]).toEqual([{ sort_by: 'name', sort_order: 'desc' }])
    expect(headers[1].attributes('aria-sort')).toBe('ascending')
    expect(headers[1].text()).toContain('↑')
    await headers[1].find('button').trigger('click')
    expect(wrapper.emitted('sort')?.[1]).toEqual([{ sort_by: 'status', sort_order: 'desc' }])
  })

  it('isolates explicit controls, activates rows by keyboard, and toggles row actions in selection mode', async () => {
    const wrapper = mountTable()
    const row = wrapper.find('tbody tr')
    await row.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('activate')).toHaveLength(1)
    await row.find('[data-row-control]').trigger('click')
    expect(wrapper.emitted('activate')).toHaveLength(1)

    const selected = mountTable(true)
    await selected.find('tbody tr').find('[data-row-action]').trigger('click')
    expect(selected.emitted('toggle')).toHaveLength(1)
    await selected.find('tbody tr').find('[data-row-control]').trigger('click')
    expect(selected.emitted('toggle')).toHaveLength(1)
  })

  it('activates the supplied mobile card through its non-control area', async () => {
    const wrapper = mountTable()
    const card = wrapper.find('.sortable-data-table-mobile article')
    await card.trigger('click')
    expect(wrapper.emitted('activate')).toHaveLength(1)
    await card.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('activate')).toHaveLength(2)
  })

  it('marks a selected supplied mobile card at the shared row boundary', () => {
    const wrapper = mount(SortableDataTable, {
      props: { rows, columns, rowKey: 'id', sort: { sort_by: 'status', sort_order: 'asc' }, selectionMode: true, selectedKeys: ['1'] },
      slots: { 'mobile-row': () => h('article', { tabindex: 0 }, '一号') },
    })
    expect(wrapper.get('.sortable-mobile-row').classes()).toContain('selected')
  })
})
