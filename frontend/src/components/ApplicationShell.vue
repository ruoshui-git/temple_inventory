<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, request } from '../lib/api'
const route = useRoute(), router = useRouter()
const boot = ref<any>()
const destinations = [{ label: '库存', path: '/' }, { label: '借用', path: '/loans' }, { label: '仓库', path: '/warehouses' }, { label: '更多', path: '/more' }]
const active = computed(() => route.path.startsWith('/loans') ? '/loans' : route.path.startsWith('/warehouses') || route.path === '/settings' ? '/warehouses' : route.path.startsWith('/more') || route.path === '/history' || route.path === '/movements' || route.path.startsWith('/reconcile') ? '/more' : '/')
const inventoryContext = computed(() => {
  const shared = { search: route.query.search, warehouses: route.query.warehouses, item_groups: route.query.item_groups }
  const inventorySort = route.path === '/' ? { sort_by: route.query.sort_by, sort_order: route.query.sort_order } : {}
  return [
    { label: '当前库存', path: '/', query: { ...shared, ...inventorySort } },
    { label: '全部物品', path: '/', query: { ...shared, ...inventorySort, mode: 'catalog' } },
    { label: '效期批次', path: '/expiry', query: { ...shared, ...(route.path === '/expiry' ? { sort_by: route.query.sort_by, sort_order: route.query.sort_order, expiry_window: route.query.expiry_window, expiry_days: route.query.expiry_days } : {}) } },
  ]
})
const browseTitle = computed(() => route.path === '/pending' ? '待处理' : route.path === '/movements' || route.path === '/history' ? '货物流动' : '')
const pending = computed(() => Number(boot.value?.pending_count || 0))
const shellHeader = ref<HTMLElement>()
const mobileNav = ref<HTMLElement>()
let headerObserver: ResizeObserver | undefined
let mobileNavObserver: ResizeObserver | undefined
function updateHeaderHeight() {
  document.documentElement.style.setProperty('--shell-header-height', `${shellHeader.value?.offsetHeight || 0}px`)
}
function updateMobileNavHeight() {
  document.documentElement.style.setProperty('--mobile-nav-height', `${mobileNav.value?.offsetHeight || 0}px`)
}
async function refresh() { try { boot.value = await api('bootstrap') } catch { /* page-level API will render the error */ } }
async function logout() { await request('logout'); window.location.href = '/login?redirect-to=%2Finventory' }
onMounted(() => {
  void refresh(); window.addEventListener('ti:refresh-shell', refresh)
  updateHeaderHeight(); headerObserver = new ResizeObserver(updateHeaderHeight)
  if (shellHeader.value) headerObserver.observe(shellHeader.value)
  updateMobileNavHeight(); mobileNavObserver = new ResizeObserver(updateMobileNavHeight)
  if (mobileNav.value) mobileNavObserver.observe(mobileNav.value)
})
onBeforeUnmount(() => { window.removeEventListener('ti:refresh-shell', refresh); headerObserver?.disconnect(); mobileNavObserver?.disconnect(); document.documentElement.style.removeProperty('--shell-header-height'); document.documentElement.style.removeProperty('--mobile-nav-height') })
</script>
<template>
  <div class="application-shell">
    <header ref="shellHeader" class="desktop-nav"><span class="shell-brand">物资管理</span><nav aria-label="主导航"><RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="active === item.path ? 'page' : undefined">{{ item.label }}</RouterLink></nav><nav v-if="active === '/' && (route.path === '/' || route.path === '/expiry')" class="desktop-inventory-context" aria-label="库存视图"><RouterLink v-for="item in inventoryContext" :key="item.label" :to="{ path: item.path, query: item.query }" :aria-current="(route.path === item.path && (item.label !== '全部物品' || route.query.mode === 'catalog') && (item.label !== '当前库存' || !route.query.mode)) ? 'page' : undefined">{{ item.label }}</RouterLink></nav><span v-if="browseTitle" class="shell-context">{{ browseTitle }}</span><div class="shell-actions"><RouterLink v-if="pending" class="pending-notice" to="/pending" :aria-label="`待处理 ${pending} 项`">待处理 <b>{{ pending }}</b></RouterLink><button type="button" @click="logout">退出登录</button></div></header>
    <main class="shell-content"><slot /></main>
    <nav ref="mobileNav" class="mobile-nav" aria-label="主导航"><RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="active === item.path ? 'page' : undefined"><svg v-if="item.label === '库存'" aria-hidden="true" viewBox="0 0 24 24"><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v8m9-4-9 4-9-4m9 4v10" /></svg><svg v-else-if="item.label === '借用'" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" /></svg><svg v-else-if="item.label === '仓库'" aria-hidden="true" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10H3V10Zm4 10v-6h10v6M7 10h10" /></svg><svg v-else aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg><span>{{ item.label }}</span></RouterLink></nav>
  </div>
</template>
