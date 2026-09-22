import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import ApplicationShell from '../src/components/ApplicationShell.vue'

const state = vi.hoisted(() => ({
  route: { path: '/', query: {} as Record<string, unknown>, params: {} as Record<string, unknown> },
  api: vi.fn(async () => ({ pending_count: 0 })),
  request: vi.fn(),
}))
const route = reactive(state.route)

vi.mock('../src/lib/api', () => ({ api: state.api, request: state.request }))
vi.mock('vue-router', () => ({ useRoute: () => route }))

const RouterLink = defineComponent({
  props: ['to', 'ariaCurrent'],
  template: '<a :data-to="typeof to === \'string\' ? to : to.path" :aria-current="ariaCurrent"><slot /></a>',
})

describe('ApplicationShell navigation contract', () => {
  beforeEach(() => {
    route.path = '/'
    route.query = {}
    route.params = {}
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class { observe() {} disconnect() {} },
    })
  })

  it('keeps all six primary destinations in the agreed order', () => {
    const wrapper = mount(ApplicationShell, { global: { stubs: { RouterLink } } })
    const labels = wrapper.find('nav[aria-label="主导航"]').findAll('a').map(link => link.text())
    expect(labels).toEqual(['库存', '货物流动', '盘点调整', '借用', '仓库', '更多'])
  })

  it('shows the complete Inventory context on Expiry and selects exactly one item', async () => {
    route.path = '/expiry'
    const wrapper = mount(ApplicationShell, { global: { stubs: { RouterLink } } })
    await nextTick()
    const context = wrapper.find('nav.desktop-inventory-context')
    expect(context.findAll('a').map(link => link.text())).toEqual(['当前库存', '全部物品', '效期批次'])
    expect(context.findAll('a[aria-current="page"]')).toHaveLength(1)
    expect(context.find('a[aria-current="page"]').text()).toBe('效期批次')
  })

  it('normalizes default context state and gives Adjustments no subnavigation', async () => {
    route.path = '/movements'
    route.query = {}
    const wrapper = mount(ApplicationShell, { global: { stubs: { RouterLink } } })
    await nextTick()
    expect(wrapper.findAll('nav.desktop-inventory-context a[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.find('nav.desktop-inventory-context a[aria-current="page"]').text()).toBe('入库')
    route.path = '/adjustments'
    await nextTick()
    expect(wrapper.find('nav.desktop-inventory-context').exists()).toBe(false)
  })
})
