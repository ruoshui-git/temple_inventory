<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from '../composables/filters'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import CategorySelector from '../components/CategorySelector.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import ItemImagePreview from '../components/ItemImagePreview.vue'
import { formatExpiryDuration } from '../lib/duration'

const route = useRoute()
const router = useRouter()
const boot = ref<any>()
const rows = ref<any[]>([])
const error = ref('')
const busy = ref(false)
const refreshing = ref(false)
const total = ref(0)
const overallTotal = ref(0)
const facetCounts = ref<any>({ warehouses: {}, item_groups: {} })
const start = ref(0)
const pageLength = 25
const filterOpen = ref(false)
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const canMove = computed(() => ['Receive', 'Issue', 'Transfer', 'Loan', 'Return', 'Damage', 'Loss', 'Repair', 'Disposal'].some(kind => operationCaps.value[kind]))
const movementActions = computed(() => ['Receive', 'Issue', 'Transfer'].filter(kind => operationCaps.value[kind]).map(kind => ({ kind, label: ({ Receive: '入库', Issue: '出库', Transfer: '转移' } as any)[kind] })))
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null)
const sentinel = ref<HTMLElement>()
const resultsPane = ref<HTMLElement>()
const scrollKey = 'temple_inventory.scroll.expiry'
const filters = ref({
  search: '',
  warehouses: [] as string[],
  item_groups: [] as string[],
  expiry_window: '',
  expiry_days: '30',
  sort: 'asc',
})
const expiryWindows = [
  { value: 'overdue_within', prefix: '已过期', suffix: '天以下' },
  { value: 'overdue_beyond', prefix: '已过期', suffix: '天以上' },
  { value: 'remaining_within', prefix: '还剩', suffix: '天以下' },
  { value: 'remaining_beyond', prefix: '还剩', suffix: '天以上' },
]
const routeValidationError = ref('')
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const expiryDays = computed(() => /^[1-9]\d*$/.test(filters.value.expiry_days) ? filters.value.expiry_days : '30')
const expiryWindowLabel = (value = filters.value.expiry_window) => {
  const mode = expiryWindows.find(option => option.value === value)
  return mode ? `${mode.prefix}${expiryDays.value}${mode.suffix}` : ''
}

const activeCount = computed(() =>
  filters.value.warehouses.length +
  filters.value.item_groups.length +
  (filters.value.search ? 1 : 0) +
  (filters.value.expiry_window ? 1 : 0),
)
const inventoryQuery = computed(() => serializeFilterQuery({
  search: filters.value.search,
  warehouses: filters.value.warehouses,
  item_groups: filters.value.item_groups,
}))
const chips = computed(() => [
  ...filters.value.warehouses.map(value => ({
    key: 'warehouses',
    value,
    label: warehouseText(value),
  })),
  ...filters.value.item_groups.map(value => ({
    key: 'item_groups',
    value,
    label: boot.value?.item_groups?.find((group: any) => group.name === value)?.item_group_name || value,
  })),
  ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : []),
  ...(filters.value.expiry_window ? [{ key: 'expiry_window', label: expiryWindowLabel() }] : []),
])

function setExpiryWindow(window: string) {
  filters.value.expiry_window = window
  if (window && !/^[1-9]\d*$/.test(filters.value.expiry_days)) filters.value.expiry_days = '30'
}
function normalizeExpiryDays() {
  if (!/^[1-9]\d*$/.test(filters.value.expiry_days)) filters.value.expiry_days = '30'
}

function removeChip(chip: any) {
  if (chip.key === 'warehouses') filters.value.warehouses = filters.value.warehouses.filter(value => value !== chip.value)
  else if (chip.key === 'item_groups') filters.value.item_groups = filters.value.item_groups.filter(value => value !== chip.value)
  else (filters.value as any)[chip.key] = ''
}
function clearAll() {
  filters.value = { search: '', warehouses: [], item_groups: [], expiry_window: '', expiry_days: '30', sort: 'asc' }
  start.value = 0
}

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let sequence = 0
let syncingRoute = false
let restoringRoute = false
let observer: IntersectionObserver | undefined
function operation(kind: string) { void router.push(`/new/${kind}`) }
async function load(append = false) {
  if (!boot.value) return
  if (timer) clearTimeout(timer)
  controller?.abort()
  const current = ++sequence
  controller = new AbortController()
  const run = async () => {
    refreshing.value = rows.value.length > 0
    busy.value = rows.value.length === 0
    error.value = ''
    try {
      const data = await api('expiring_batches', {
        ...filters.value,
        expiry_days: filters.value.expiry_window ? expiryDays.value : undefined,
        warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
        item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
        start: append ? rows.value.length : start.value,
        page_length: pageLength,
      }, controller?.signal)
      if (current !== sequence) return
      rows.value = append ? [...rows.value, ...(data.results || []).filter((row: any) => !rows.value.some(old => old.batch_no === row.batch_no))] : (data.results || [])
		 total.value = data.total || 0
		 facetCounts.value = data.facets || facetCounts.value
		overallTotal.value = data.overall_total || 0
      syncingRoute = true
      void router.replace({
        query: { ...route.query, ...serializeFilterQuery({ ...filters.value, expiry_days: filters.value.expiry_window ? expiryDays.value : undefined, start: start.value || undefined }) },
      }).finally(() => { syncingRoute = false })
    } catch (cause: any) {
      if (current === sequence && cause?.name !== 'AbortError') error.value = cause.message
    } finally {
      if (current === sequence) {
        busy.value = false
        refreshing.value = false
      }
    }
  }
  if (filters.value.search) timer = setTimeout(() => void run(), 300)
  else await run()
}

watch(filters, () => {
  const preserveStart = restoringRoute
  restoringRoute = false
  if (!preserveStart) start.value = 0
  if (!preserveStart) resultsPane.value?.scrollTo({ top: 0 })
  void load()
}, { deep: true })

watch(() => route.query, query => {
  if (syncingRoute || !boot.value) return
  const hydrated = hydrateFilterQuery(query as Record<string, unknown>, { search: '', warehouses: [] as string[], item_groups: [] as string[], expiry_window: '', expiry_days: '30', sort: 'asc', start: '0' })
  const requestedWindow = String(hydrated.expiry_window || '')
  const requestedDays = String(hydrated.expiry_days || '')
  const validWindow = requestedWindow === '' || expiryWindows.some(option => option.value === requestedWindow)
  const validDays = /^[1-9]\d*$/.test(requestedDays)
  if (!validWindow || !validDays) routeValidationError.value = '效期范围参数无效，已恢复为默认值。'
  const next = { search: String(hydrated.search || ''), warehouses: hydrated.warehouses as string[], item_groups: hydrated.item_groups as string[], expiry_window: validWindow ? requestedWindow : '', expiry_days: validDays ? requestedDays : '30', sort: String(hydrated.sort || 'asc') }
  const changed = Object.keys(next).some(key => !sameFilterValue((filters.value as any)[key], (next as any)[key]))
  if (!changed && start.value === (Number(hydrated.start) || 0)) return
  restoringRoute = true
  filters.value = next
  start.value = Number(hydrated.start) || 0
}, { deep: true })

onMounted(async () => {
  try {
    boot.value = await api('bootstrap')
    const hydrated = hydrateFilterQuery(route.query as Record<string, unknown>, {
      search: '',
      warehouses: [] as string[],
      item_groups: [] as string[],
      expiry_window: '',
      expiry_days: '30',
      sort: 'asc',
      start: '0',
    })
    filters.value = {
      search: String(hydrated.search || ''),
      warehouses: hydrated.warehouses as string[],
      item_groups: hydrated.item_groups as string[],
      expiry_window: String(hydrated.expiry_window || ''),
      expiry_days: /^[1-9]\d*$/.test(String(hydrated.expiry_days || '')) ? String(hydrated.expiry_days) : '30',
      sort: String(hydrated.sort || 'asc'),
    }
    start.value = Number(hydrated.start) || 0
    await load()
    await nextTick()
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && rows.value.length < total.value && !busy.value) void load(true)
    }, { rootMargin: '240px' })
    if (sentinel.value) observer.observe(sentinel.value)
    const saved = Number(sessionStorage.getItem(scrollKey) || 0)
    if (saved) resultsPane.value?.scrollTo({ top: saved })
  } catch (cause: any) {
    error.value = cause.message
  }
})
onBeforeUnmount(() => { controller?.abort(); observer?.disconnect(); if (resultsPane.value) sessionStorage.setItem(scrollKey, String(resultsPane.value.scrollTop)) })
</script>

<template>
  <main class="inventory-destination wide-shell">
    <nav class="inventory-modes" aria-label="库存视图"><RouterLink :to="{ path: '/', query: inventoryQuery }">当前库存</RouterLink><RouterLink :to="{ path: '/', query: { ...inventoryQuery, mode: 'catalog' } }">全部物品</RouterLink><RouterLink class="active" :to="{ path: '/expiry', query: { ...inventoryQuery, ...(filters.expiry_window ? { expiry_window: filters.expiry_window, expiry_days: expiryDays } : {}), sort: filters.sort !== 'asc' ? filters.sort : undefined } }">效期批次</RouterLink></nav>
    <p v-if="error || routeValidationError" class="error">{{ error || routeValidationError }} <button type="button" @click="load()">重试</button></p>
    <div class="list-layout desktop-list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen" :count="activeCount">
        <WarehouseSelector v-model="filters.warehouses" :rows="warehouseRows" :counts="facetCounts.warehouses" />
        <CategorySelector v-model="filters.item_groups" :rows="boot?.item_groups || []" :counts="facetCounts.item_groups" />
        <fieldset class="choice-list"><legend>效期范围</legend><label class="choice-row"><input type="radio" value="" :checked="!filters.expiry_window" @change="setExpiryWindow('')">全部效期</label><label v-for="option in expiryWindows" :key="option.value" class="choice-row"><input type="radio" :value="option.value" :checked="filters.expiry_window === option.value" @change="setExpiryWindow(option.value)">{{ option.prefix }}{{ expiryDays }}{{ option.suffix }}</label><label v-if="filters.expiry_window">天数<input v-model="filters.expiry_days" type="number" min="1" step="1" inputmode="numeric" @change="normalizeExpiryDays"></label></fieldset>
        <fieldset class="choice-list"><legend>排序</legend><label class="choice-row"><input v-model="filters.sort" type="radio" value="asc">最近到期优先</label><label class="choice-row"><input v-model="filters.sort" type="radio" value="desc">最晚到期优先</label></fieldset>
      </ResponsiveFilterPanel>
      <div ref="resultsPane" class="results-column">
        <div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索物品或批次" aria-label="搜索物品或批次"><button class="mobile-filter-button" type="button" @click="filterPanel?.openPanel($event)">筛选<span v-if="activeCount">（{{ activeCount }}）</span></button><span aria-live="polite">{{ refreshing ? '正在更新…' : `已加载 ${rows.length} · 筛选结果 ${total} · 全部效期批次 ${overallTotal}` }}</span></div>
        <ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
        <LoadingIndicator v-if="busy && !rows.length" text="正在加载有效期…" />
        <template v-else>
          <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th scope="col">物品 / 批次</th><th scope="col">类别</th><th scope="col">到期日期</th><th scope="col">剩余</th><th scope="col">数量</th><th scope="col">位置</th></tr></thead><tbody><tr v-for="row in rows" :key="row.batch_no" :class="{ 'expiry-overdue-row': row.days_to_expiry < 0 }"><td><div class="item-identity"><ItemImagePreview :src="row.image" :alt="row.item_name"/><RouterLink :to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"><b>{{ row.item_name }}</b><small>{{ row.item_code }} · {{ row.batch_no }}</small></RouterLink></div></td><td>{{ row.item_group }}</td><td>{{ row.expiry_date }}</td><td :class="{ warn: row.days_to_expiry < 0 }">{{ formatExpiryDuration(row.days_to_expiry) }}</td><td class="quantity">{{ row.total_qty }} {{ row.stock_uom }}</td><td><span v-for="location in row.locations" :key="location.warehouse" class="location-line">{{ warehouseText(location.warehouse) }}：{{ location.qty }}</span></td></tr></tbody></table></div>
          <div class="mobile-cards"><article v-for="row in rows" :key="row.batch_no" class="item-card" :class="{ 'expiry-overdue-row': row.days_to_expiry < 0 }"><ItemImagePreview :src="row.image" :alt="row.item_name"/><div><RouterLink :to="`/item/${encodeURIComponent(row.item_code)}?batch=${encodeURIComponent(row.batch_no)}`"><b>{{ row.item_code }} · {{ row.item_name }}</b><p>{{ row.item_group }} · 批次 {{ row.batch_no }} · {{ row.total_qty }} {{ row.stock_uom }}</p><p>到期 {{ row.expiry_date }} · <span :class="{ warn: row.days_to_expiry < 0 }">{{ formatExpiryDuration(row.days_to_expiry) }}</span></p></RouterLink></div></article></div>
          <p v-if="!rows.length" class="empty-state">暂无有库存的有效期批次</p>
        </template>
        <div ref="sentinel" aria-hidden="true"></div><button v-if="rows.length < total" :disabled="busy" @click="load(true)">{{busy?'正在加载…':'加载更多'}}</button>
      </div>
    </div><FloatingActionMenu v-if="canMove" :actions="movementActions" @select="operation"/>
  </main>
</template>
