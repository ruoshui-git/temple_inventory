import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, defineComponent } from 'vue'
import Inventory from '../src/pages/Inventory.vue'
import Expiry from '../src/pages/Expiry.vue'

const state = vi.hoisted(() => ({
  route: { query: {} as Record<string, any>, path: '/' },
  api: vi.fn(),
  replace: vi.fn(async (value: any) => { state.route.query = value.query || state.route.query }),
  push: vi.fn(),
}))
const route = reactive(state.route)
vi.mock('../src/lib/api', () => ({ api: state.api }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: state.replace, push: state.push }) }))
vi.mock('../src/lib/toast', () => ({ toast: vi.fn() }))

const child = defineComponent({ template: '<div><slot /></div>' })
const scanner = defineComponent({ emits: ['scan', 'close'], template: '<button class="test-scan" @click="$emit(\'scan\', \'A001\')">scan</button>' })
const globals = { stubs: {
  WarehouseSelector: child, CategorySelector: child, ActiveFilterChips: child, FloatingActionMenu: child,
  ResponsiveFilterPanel: child, LoadingIndicator: child, ItemImagePreview: child, Scanner: scanner,
  RouterLink: defineComponent({ props: ['to'], template: '<a :href="String(to)"><slot /></a>' }),
} }
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 320)); await flushPromises() }

function inventoryRows() { return [{ item_code: 'A001', item_name: '一号', item_group: '杂项', available_stock: 3, total_stock: 5, on_loan_qty: 1, damaged_qty: 0, stock_uom: '件' }] }
function expiryRows() { return [{ batch_no: 'B001', item_code: 'A001', item_name: '一号', item_group: '杂项', expiry_date: '2026-10-01', days_to_expiry: 10, total_qty: 2, stock_uom: '件', locations: [] }] }

beforeEach(() => {
  state.route.query = {}; state.route.path = '/'; state.api.mockReset(); state.replace.mockClear(); state.push.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true })
  Object.defineProperty(window, 'IntersectionObserver', { value: class { observe() {} disconnect() {} }, configurable: true })
  state.api.mockImplementation(async (method: string) => method === 'bootstrap' ? { item_groups: [], physical_tree: [], stock_operation_capabilities: {} } : method === 'inventory' ? { results: inventoryRows(), total: 1, overall_total: 1, facets: {} } : { results: expiryRows(), total: 1, overall_total: 1, facets: {} })
})

describe('Inventory and Expiry integrations', () => {
  it('keeps browse chrome outside the dedicated results scroll and uses shared primary cells', async () => {
    const inventory = mount(Inventory, { global: globals }); await flushPromises()
    expect(inventory.find('.results-chrome').exists()).toBe(true)
    expect(inventory.find('.results-scroll').exists()).toBe(true)
    expect(inventory.find('.primary-cell .primary-text').text()).toBe('一号')
    state.route.path = '/expiry'
    const expiry = mount(Expiry, { global: globals }); await flushPromises()
    expect(expiry.find('.results-chrome').exists()).toBe(true)
    expect(expiry.find('.results-scroll').exists()).toBe(true)
    expect(expiry.find('.primary-cell .secondary-text').text()).toBe('A001 · B001')
  })

  it('requests Inventory default sort, reverses it, resets rows, and serializes non-default state', async () => {
    const wrapper = mount(Inventory, { global: globals }); await flushPromises()
    const request = state.api.mock.calls.find(call => call[0] === 'inventory')
    expect(request[1]).toMatchObject({ sort_by: 'item_name', sort_order: 'asc' })
    await wrapper.find('.sortable-data-table th button').trigger('click'); await settle()
    expect(state.api.mock.calls.some(call => call[0] === 'inventory' && call[1].sort_by === 'item_name' && call[1].sort_order === 'desc')).toBe(true)
    expect(state.replace).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ sort_by: 'item_name', sort_order: 'desc' }) }))
    await wrapper.find('.sortable-data-table th button').trigger('click'); await settle()
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_by).toBeUndefined()
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_order).toBeUndefined()
  })

  it('keeps Inventory scanner modal lookup pending and handles known and unknown results', async () => {
    state.api.mockImplementation(async (method: string, payload?: any) => {
      if (method === 'bootstrap') return { item_groups: [], physical_tree: [], stock_operation_capabilities: {} }
      if (method === 'scan') return payload.value === 'UNKNOWN' ? { unknown: true } : { item_code: 'A001' }
      return { results: inventoryRows(), total: 1, overall_total: 1, facets: {} }
    })
    const wrapper = mount(Inventory, { global: globals }); await flushPromises()
    await wrapper.find('[aria-label="扫描条码"]').trigger('click')
    const scan = wrapper.findComponent(scanner)
    expect(scan.exists()).toBe(true)
    await scan.vm.$emit('scan', 'A001'); await flushPromises()
    expect(state.push).toHaveBeenCalledWith('/item/A001')
    await wrapper.find('[aria-label="扫描条码"]').trigger('click')
    await wrapper.findComponent(scanner).vm.$emit('scan', 'UNKNOWN'); await flushPromises()
    expect(wrapper.text()).toContain('未找到物品')
  })

  it('keeps the Inventory scanner open after a lookup failure', async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === 'bootstrap') return { item_groups: [], physical_tree: [], stock_operation_capabilities: {} }
      if (method === 'scan') throw new Error('查询失败')
      return { results: inventoryRows(), total: 1, overall_total: 1, facets: {} }
    })
    const wrapper = mount(Inventory, { global: globals }); await flushPromises()
    await wrapper.find('[aria-label="扫描条码"]').trigger('click')
    await wrapper.findComponent(scanner).vm.$emit('scan', 'BROKEN'); await flushPromises()
    expect(wrapper.findComponent(scanner).exists()).toBe(true)
    expect(wrapper.text()).toContain('查询失败')
  })

  it('hydrates Expiry legacy sort, removes the sidebar sorter, and sends canonical sort state', async () => {
    state.route.path = '/expiry'; state.route.query = { sort: 'desc' }
    const wrapper = mount(Expiry, { global: globals }); await flushPromises()
    expect(wrapper.find('fieldset').exists()).toBe(true)
    expect(wrapper.findAll('fieldset').some(fieldset => fieldset.text().includes('排序'))).toBe(false)
    expect(state.api.mock.calls.find(call => call[0] === 'expiring_batches')?.[1]).toMatchObject({ sort_by: 'expiry_date', sort_order: 'desc' })
    expect(state.replace).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ sort_by: 'expiry_date', sort_order: 'desc' }) }))
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort).toBeUndefined()
  })

  it('uses Expiry first-click directions and resets to the default canonical sort', async () => {
    state.route.path = '/expiry'
    const wrapper = mount(Expiry, { global: globals }); await flushPromises()
    await wrapper.findAll('.sortable-data-table th button')[0].trigger('click'); await settle()
    expect(state.api.mock.calls.some(call => call[0] === 'expiring_batches' && call[1].sort_by === 'item_name' && call[1].sort_order === 'asc')).toBe(true)
    await wrapper.findAll('.sortable-data-table th button')[1].trigger('click'); await settle()
    await wrapper.findAll('.sortable-data-table th button')[1].trigger('click'); await settle()
    expect(state.api.mock.calls.some(call => call[0] === 'expiring_batches' && call[1].sort_by === 'expiry_date' && call[1].sort_order === 'desc')).toBe(true)
    await wrapper.findAll('.sortable-data-table th button')[1].trigger('click'); await settle()
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_by).toBeUndefined()
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_order).toBeUndefined()
  })

  it('hydrates Expiry when browser navigation changes only the sort', async () => {
    state.route.path = '/expiry'
    mount(Expiry, { global: globals }); await flushPromises()
    route.query = { sort_by: 'total_qty', sort_order: 'desc' }
    await settle()
    expect(state.api.mock.calls.at(-1)?.[1]).toMatchObject({ sort_by: 'total_qty', sort_order: 'desc' })
  })
})
