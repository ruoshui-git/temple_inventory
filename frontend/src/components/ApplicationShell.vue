<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, type LocationQueryRaw } from 'vue-router'
import { api, request } from '../lib/api'

type Destination = {
  key: 'inventory' | 'movements' | 'adjustments' | 'loans' | 'warehouses' | 'more'
  label: string
  path: string
}
type ContextItem = { key: string; label: string; path: string; query: LocationQueryRaw }

const route = useRoute()
const boot = ref<any>()
const destinations: Destination[] = [
  { key: 'inventory', label: '库存', path: '/' },
  { key: 'movements', label: '货物流动', path: '/movements' },
  { key: 'adjustments', label: '盘点调整', path: '/adjustments' },
  { key: 'loans', label: '借用', path: '/loans' },
  { key: 'warehouses', label: '仓库', path: '/warehouses' },
  { key: 'more', label: '更多', path: '/more' },
]

const activeDestination = computed(() => {
  if (route.path === '/movements' || route.path === '/history' || ['Receive', 'Issue', 'Transfer'].includes(String(route.params.kind || ''))) return '/movements'
  if (route.path === '/adjustments' || route.path.startsWith('/reconcile')) return '/adjustments'
  if (route.path.startsWith('/loans') || route.path === '/new/Loan') return '/loans'
  if (route.path.startsWith('/warehouses') || route.path === '/settings') return '/warehouses'
  if (route.path === '/more' || route.path === '/drafts' || route.path === '/pending') return '/more'
  return '/'
})

const inventorySharedQuery = computed<LocationQueryRaw>(() => ({
  search: route.query.search,
  warehouses: route.query.warehouses,
  item_groups: route.query.item_groups,
}))
const movementSharedQuery = computed<LocationQueryRaw>(() => ({
  search: route.query.search,
  posting_date: route.query.posting_date,
  item_groups: route.query.item_groups,
  sort_by: route.query.sort_by,
  sort_order: route.query.sort_order,
}))
const loanSharedQuery = computed<LocationQueryRaw>(() => ({
  search: route.query.search,
  loan_date: route.query.loan_date,
  item_groups: route.query.item_groups,
  warehouses: route.query.warehouses,
  activity: route.query.activity,
  sort_by: route.query.sort_by,
  sort_order: route.query.sort_order,
}))

const contextItems = computed<ContextItem[]>(() => {
  if (route.path === '/' || route.path === '/expiry') return [
    { key: 'current', label: '当前库存', path: '/', query: inventorySharedQuery.value },
    { key: 'catalog', label: '全部物品', path: '/', query: { ...inventorySharedQuery.value, mode: 'catalog' } },
    { key: 'expiry', label: '效期批次', path: '/expiry', query: inventorySharedQuery.value },
  ]
  if (route.path === '/movements' || route.path === '/history') return [
    { key: 'Receive', label: '入库', path: '/movements', query: { ...movementSharedQuery.value, kind: 'Receive' } },
    { key: 'Issue', label: '出库', path: '/movements', query: { ...movementSharedQuery.value, kind: 'Issue' } },
    { key: 'Transfer', label: '转移', path: '/movements', query: { ...movementSharedQuery.value, kind: 'Transfer' } },
  ]
  if (route.path === '/loans') return [
    { key: 'outstanding', label: '未结借用', path: '/loans', query: loanSharedQuery.value },
    { key: 'settled', label: '已结借用', path: '/loans', query: { ...loanSharedQuery.value, status: 'settled' } },
  ]
  return []
})

const contextKey = computed(() => {
  if (route.path === '/') return route.query.mode === 'catalog' ? 'catalog' : 'current'
  if (route.path === '/expiry') return 'expiry'
  if (route.path === '/movements' || route.path === '/history') {
    const requested = String(route.query.kind || route.query.movement_kind || '')
    return ['Issue', 'Transfer'].includes(requested) ? requested : 'Receive'
  }
  if (route.path === '/loans') return route.query.status === 'settled' ? 'settled' : 'outstanding'
  return ''
})

const browseTitle = computed(() => {
  if (route.path === '/') return contextKey.value === 'catalog' ? '全部物品' : '当前库存'
  if (route.path === '/expiry') return '效期批次'
  if (route.path === '/movements' || route.path === '/history') return ({ Receive: '入库', Issue: '出库', Transfer: '转移' } as Record<string, string>)[contextKey.value]
  if (route.path === '/adjustments') return '盘点调整'
  if (route.path === '/drafts') return '草稿'
  if (route.path === '/loans') return contextKey.value === 'settled' ? '已结借用' : '未结借用'
  if (route.path === '/pending') return '待处理'
  if (route.path === '/warehouses') return '仓库'
  if (route.path === '/more') return '更多'
  return '物资管理'
})
const detailRoute = computed(() => /^\/(item|workspace|entry|new|reconcile|loans\/[^/]+|warehouses\/[^/]+)/.test(route.path))
const pending = computed(() => Number(boot.value?.pending_count || 0))
const shellHeader = ref<HTMLElement>()
const mobileNav = ref<HTMLElement>()
const mobileContextNav = ref<HTMLElement>()
let headerObserver: ResizeObserver | undefined
let mobileNavObserver: ResizeObserver | undefined
let mobileContextObserver: ResizeObserver | undefined

function updateLayoutHeights() {
  document.documentElement.style.setProperty('--shell-header-height', `${shellHeader.value?.offsetHeight || 0}px`)
  document.documentElement.style.setProperty('--mobile-nav-height', `${mobileNav.value?.offsetHeight || 0}px`)
  document.documentElement.style.setProperty('--mobile-context-nav-height', `${mobileContextNav.value?.offsetHeight || 0}px`)
}
async function observeContextNav() {
  await nextTick()
  mobileContextObserver?.disconnect()
  if (mobileContextNav.value) mobileContextObserver?.observe(mobileContextNav.value)
  updateLayoutHeights()
}
async function refresh() {
  try { boot.value = await api('bootstrap') } catch { /* page-level API renders errors */ }
}
async function logout() {
  await request('logout')
  window.location.href = '/login?redirect-to=%2Finventory'
}

watch(contextItems, () => { void observeContextNav() })
onMounted(() => {
  void refresh()
  window.addEventListener('ti:refresh-shell', refresh)
  headerObserver = new ResizeObserver(updateLayoutHeights)
  mobileNavObserver = new ResizeObserver(updateLayoutHeights)
  mobileContextObserver = new ResizeObserver(updateLayoutHeights)
  if (shellHeader.value) headerObserver.observe(shellHeader.value)
  if (mobileNav.value) mobileNavObserver.observe(mobileNav.value)
  void observeContextNav()
})
onBeforeUnmount(() => {
  window.removeEventListener('ti:refresh-shell', refresh)
  headerObserver?.disconnect()
  mobileNavObserver?.disconnect()
  mobileContextObserver?.disconnect()
  document.documentElement.style.removeProperty('--shell-header-height')
  document.documentElement.style.removeProperty('--mobile-nav-height')
  document.documentElement.style.removeProperty('--mobile-context-nav-height')
})
</script>

<template>
  <div class="application-shell">
    <header ref="shellHeader" class="desktop-nav">
      <h1 class="shell-brand" :class="{ 'sr-only': detailRoute }">{{ detailRoute ? '物资管理' : browseTitle }}</h1>
      <nav aria-label="主导航">
        <RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="activeDestination === item.path ? 'page' : undefined">{{ item.label }}</RouterLink>
      </nav>
      <nav v-if="contextItems.length" class="desktop-inventory-context" aria-label="当前视图">
        <RouterLink v-for="item in contextItems" :key="item.key" :to="{ path: item.path, query: item.query }" :aria-current="contextKey === item.key ? 'page' : undefined">{{ item.label }}</RouterLink>
      </nav>
      <div class="shell-actions">
        <RouterLink v-if="pending" class="pending-notice" to="/pending" :aria-label="`待处理 ${pending} 项`">待处理 <b>{{ pending }}</b></RouterLink>
        <button type="button" @click="logout">退出登录</button>
      </div>
    </header>
    <main class="shell-content"><slot /></main>
    <nav v-if="contextItems.length" ref="mobileContextNav" class="mobile-context-nav" aria-label="当前视图">
      <RouterLink v-for="item in contextItems" :key="item.key" :to="{ path: item.path, query: item.query }" :aria-current="contextKey === item.key ? 'page' : undefined">{{ item.label }}</RouterLink>
    </nav>
    <nav ref="mobileNav" class="mobile-nav" aria-label="主导航">
      <RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="activeDestination === item.path ? 'page' : undefined">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path v-if="item.key === 'inventory'" d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10" />
          <path v-else-if="item.key === 'movements'" d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3 3m-3-3 3-3" />
          <path v-else-if="item.key === 'adjustments'" d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h7m4 0h5M14 4v4M6 10v4m5 2v4" />
          <path v-else-if="item.key === 'loans'" d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" />
          <path v-else-if="item.key === 'warehouses'" d="m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10" />
          <path v-else d="M5 12h.01M12 12h.01M19 12h.01" />
        </svg>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
