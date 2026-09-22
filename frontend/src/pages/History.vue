<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, labels, workspaceApi } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from '../composables/filters'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import CategorySelector from '../components/CategorySelector.vue'
import DetailPopover from '../components/DetailPopover.vue'
import IconButton from '../components/IconButton.vue'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import SortableDataTable, { type SortState } from '../components/SortableDataTable.vue'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import { returnToOpener } from '../lib/navigation'

type Destination = 'movements' | 'adjustments' | 'drafts'
type HistoryFilters = {
  search: string
  posting_date: string
  movement_kind: string
  item_groups: string[]
  warehouses: string[]
  source_warehouses: string[]
  destination_warehouses: string[]
}

const props = withDefaults(defineProps<{ destination?: Destination }>(), { destination: 'movements' })
const route = useRoute()
const router = useRouter()
const boot = ref<any>()
const rows = ref<any[]>([])
const total = ref(0)
const overallTotal = ref(0)
const facets = ref<Record<string, Record<string, number>>>({
  movement_kind: {}, warehouses: {}, source_warehouses: {}, destination_warehouses: {}, item_groups: {},
})
const start = ref(0)
const error = ref('')
const appendError = ref('')
const busy = ref(true)
const refreshing = ref(false)
const appending = ref(false)
const filterOpen = ref(false)
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null)
const sentinel = ref<HTMLElement>()
const resultsScroll = ref<HTMLElement>()
const pageLength = 25
const defaultSort: SortState = { sort_by: 'posting_date', sort_order: 'desc' }
const sort = ref<SortState>({ ...defaultSort })
const movementKind = computed(() => {
  const requested = String(route.query.kind || route.query.movement_kind || '')
  return ['Issue', 'Transfer'].includes(requested) ? requested : 'Receive'
})
const statusGroup = computed(() => props.destination === 'drafts' ? 'unfinished' : 'completed')
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const scrollKey = computed(() => `temple_inventory.scroll.${props.destination}`)
const filters = ref<HistoryFilters>({
  search: '', posting_date: '', movement_kind: '', item_groups: [], warehouses: [], source_warehouses: [], destination_warehouses: [],
})

const movementColumns = [
  { key: 'posting_date', label: '日期', sortable: true, initialOrder: 'desc' as const },
  { key: 'line_count', label: '物品行数', sortable: true },
  { key: 'location_count', label: '位置数量', sortable: true },
  { key: 'category_count', label: '相关类别', sortable: true },
  { key: 'status', label: '状态' },
]
const adjustmentColumns = [
  { key: 'movement_kind', label: '类型', sortable: true },
  { key: 'posting_date', label: '日期', sortable: true, initialOrder: 'desc' as const },
  { key: 'increase_line_count', label: '增加物品行数', sortable: true },
  { key: 'decrease_line_count', label: '减少物品行数', sortable: true },
  { key: 'status', label: '状态' },
]
const draftColumns = [
  { key: 'movement_kind', label: '类型', sortable: true },
  { key: 'posting_date', label: '日期', sortable: true, initialOrder: 'desc' as const },
  { key: 'line_count', label: '物品行数', sortable: true },
  { key: 'status', label: '状态' },
  { key: 'actions', label: '操作' },
]
const sortColumns = computed(() => props.destination === 'adjustments' ? adjustmentColumns : props.destination === 'drafts' ? draftColumns : movementColumns)
const activeCount = computed(() => (
  (filters.value.search ? 1 : 0) +
  (filters.value.posting_date ? 1 : 0) +
  (props.destination === 'adjustments' && filters.value.movement_kind ? 1 : 0) +
  filters.value.item_groups.length + filters.value.warehouses.length +
  filters.value.source_warehouses.length + filters.value.destination_warehouses.length
))
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const chips = computed(() => [
  ...filters.value.warehouses.map(value => ({ key: 'warehouses', value, label: warehouseText(value) })),
  ...filters.value.source_warehouses.map(value => ({ key: 'source_warehouses', value, label: `来源：${warehouseText(value)}` })),
  ...filters.value.destination_warehouses.map(value => ({ key: 'destination_warehouses', value, label: `去向：${warehouseText(value)}` })),
  ...filters.value.item_groups.map(value => ({ key: 'item_groups', value, label: `类别：${value}` })),
  ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : []),
  ...(filters.value.posting_date ? [{ key: 'posting_date', label: `日期：${filters.value.posting_date}` }] : []),
  ...(props.destination === 'adjustments' && filters.value.movement_kind ? [{ key: 'movement_kind', label: filters.value.movement_kind === '盘点调整' ? '类型：库存盘点' : '类型：期初库存' }] : []),
])

function removeChip(chip: any) {
  const value = filters.value[chip.key as keyof HistoryFilters]
  if (Array.isArray(value)) (filters.value as any)[chip.key] = value.filter(item => item !== chip.value)
  else (filters.value as any)[chip.key] = ''
}
function clearAll() {
  filters.value = { search: '', posting_date: '', movement_kind: '', item_groups: [], warehouses: [], source_warehouses: [], destination_warehouses: [] }
}
function requestFilters() {
  const base: Record<string, unknown> = {
    search: filters.value.search || undefined,
    posting_date: filters.value.posting_date || undefined,
    item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
  }
  if (props.destination === 'movements') {
    base.movement_kind = movementKind.value
    if (movementKind.value === 'Receive') base.destination_warehouses = filters.value.destination_warehouses.length ? filters.value.destination_warehouses : undefined
    if (movementKind.value === 'Issue') base.source_warehouses = filters.value.source_warehouses.length ? filters.value.source_warehouses : undefined
    if (movementKind.value === 'Transfer') {
      base.source_warehouses = filters.value.source_warehouses.length ? filters.value.source_warehouses : undefined
      base.destination_warehouses = filters.value.destination_warehouses.length ? filters.value.destination_warehouses : undefined
    }
  } else if (props.destination === 'adjustments') {
    base.movement_kind = filters.value.movement_kind || ['盘点调整', '期初库存']
    base.warehouses = filters.value.warehouses.length ? filters.value.warehouses : undefined
  } else {
    base.movement_kind = undefined
    base.warehouses = filters.value.warehouses.length ? filters.value.warehouses : undefined
  }
  return base
}
function routeQuery() {
  const queryFilters: Record<string, unknown> = {
    search: filters.value.search,
    posting_date: filters.value.posting_date,
    item_groups: filters.value.item_groups,
    warehouses: filters.value.warehouses,
    source_warehouses: filters.value.source_warehouses,
    destination_warehouses: filters.value.destination_warehouses,
    movement_kind: props.destination === 'adjustments' ? filters.value.movement_kind : undefined,
    start: start.value || undefined,
  }
  return {
    ...(props.destination === 'movements' ? { kind: movementKind.value } : {}),
    ...serializeFilterQuery(queryFilters),
    ...(JSON.stringify(sort.value) === JSON.stringify(defaultSort) ? {} : sort.value),
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let sequence = 0
let syncingRoute = false
let restoringRoute = false
let observer: IntersectionObserver | undefined
let mediaQuery: MediaQueryList | undefined

async function load(append = false, debounce = false) {
  if (!boot.value || (append && (appending.value || rows.value.length >= total.value))) return
  if (timer) clearTimeout(timer)
  if (!append) controller?.abort()
  const current = ++sequence
  const requestController = new AbortController()
  if (!append) controller = requestController
  if (append) appending.value = true
  else if (rows.value.length) refreshing.value = true
  else busy.value = true
  if (append) appendError.value = ''
  else error.value = ''
  const run = async () => {
    try {
      const offset = append ? rows.value.length : start.value
      const data = await workspaceApi('history', {
        filters: requestFilters(), start: offset, page_length: pageLength, status_group: statusGroup.value, ...sort.value,
      }, requestController.signal)
      if (current !== sequence) return
      const incoming = data.results || []
      rows.value = append ? [...rows.value, ...incoming.filter((row: any) => !rows.value.some(old => old.name === row.name))] : incoming
      total.value = Number(data.total || 0)
      overallTotal.value = Number(data.overall_total || 0)
      facets.value = data.facets || facets.value
      if (!append) {
        syncingRoute = true
        await router.replace({ query: routeQuery() })
        syncingRoute = false
      }
    } catch (cause: any) {
      syncingRoute = false
      if (current === sequence && cause?.name !== 'AbortError') {
        if (append) appendError.value = cause.message
        else error.value = cause.message
      }
    } finally {
      if (current === sequence) {
        busy.value = false
        refreshing.value = false
        appending.value = false
      }
    }
  }
  if (debounce) timer = setTimeout(() => { void run() }, 300)
  else await run()
}

function applyQuery(query: Record<string, unknown>) {
  const hydrated = hydrateFilterQuery(query, {
    search: '', posting_date: '', movement_kind: '', item_groups: [] as string[], warehouses: [] as string[], source_warehouses: [] as string[], destination_warehouses: [] as string[], start: '0',
  })
  const next: HistoryFilters = {
    search: String(hydrated.search || ''),
    posting_date: String(hydrated.posting_date || ''),
    movement_kind: props.destination === 'adjustments' && ['盘点调整', '期初库存'].includes(String(hydrated.movement_kind)) ? String(hydrated.movement_kind) : '',
    item_groups: hydrated.item_groups as string[],
    warehouses: hydrated.warehouses as string[],
    source_warehouses: hydrated.source_warehouses as string[],
    destination_warehouses: hydrated.destination_warehouses as string[],
  }
  const requestedSort = String(query.sort_by || '')
  const requestedOrder = String(query.sort_order || '')
  const validKeys = sortColumns.value.filter(column => column.sortable).map(column => column.key)
  const nextSort: SortState = validKeys.includes(requestedSort) && ['asc', 'desc'].includes(requestedOrder)
    ? { sort_by: requestedSort, sort_order: requestedOrder as 'asc' | 'desc' }
    : { ...defaultSort }
  const nextStart = Math.max(0, Number(hydrated.start) || 0)
  const changed = Object.keys(next).some(key => !sameFilterValue(filters.value[key as keyof HistoryFilters], next[key as keyof HistoryFilters]))
  const sortChanged = sort.value.sort_by !== nextSort.sort_by || sort.value.sort_order !== nextSort.sort_order
  if (!changed && !sortChanged && start.value === nextStart) return false
  restoringRoute = true
  filters.value = next
  sort.value = nextSort
  start.value = nextStart
  void nextTick(() => { restoringRoute = false })
  return true
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) void load(true)
  }, { root: mediaQuery?.matches ? resultsScroll.value : null, rootMargin: '240px' })
  if (sentinel.value) observer.observe(sentinel.value)
}
function operation(kind: string) { void router.push(`/new/${kind}`) }
function activate(row: any) {
  const path = row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${encodeURIComponent(row.name)}`
  void router.push(path)
}
function close() { void returnToOpener(router, '/more') }
async function deleteDraft(name: string) {
  if (!window.confirm('确定删除这条未完成记录吗？此操作无法撤销。')) return
  try {
    await workspaceApi('delete_draft', { name })
    window.dispatchEvent(new Event('ti:refresh-shell'))
    await load()
  } catch (cause: any) { error.value = cause.message }
}

watch(filters, (value, previous) => {
  if (!boot.value || restoringRoute) return
  start.value = 0
  resultsScroll.value?.scrollTo({ top: 0 })
  void load(false, value.search !== previous.search)
}, { deep: true })
watch(sort, () => {
  if (!boot.value || restoringRoute) return
  start.value = 0
  resultsScroll.value?.scrollTo({ top: 0 })
  void load()
}, { deep: true })
watch(() => route.query, query => {
  if (!syncingRoute && applyQuery(query as Record<string, unknown>)) void load()
}, { deep: true })
watch(movementKind, () => {
  if (!boot.value || props.destination !== 'movements') return
  start.value = 0
  filters.value.source_warehouses = []
  filters.value.destination_warehouses = []
  void load()
})

onMounted(async () => {
  try {
    boot.value = await api('bootstrap')
    applyQuery(route.query as Record<string, unknown>)
    await load()
    await nextTick()
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(min-width: 1024px)')
      mediaQuery.addEventListener('change', setupObserver)
    }
    setupObserver()
    const saved = Number(sessionStorage.getItem(scrollKey.value) || 0)
    if (saved) resultsScroll.value?.scrollTo({ top: saved })
  } catch (cause: any) { error.value = cause.message }
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  controller?.abort()
  observer?.disconnect()
  mediaQuery?.removeEventListener('change', setupObserver)
  if (resultsScroll.value) sessionStorage.setItem(scrollKey.value, String(resultsScroll.value.scrollTop))
})
</script>

<template>
  <main class="app-shell wide-shell viewport-list-root">
    <header v-if="props.destination === 'drafts'" class="browse-back"><button type="button" @click="close">‹ 更多</button></header>
    <div class="list-layout desktop-list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen" :count="activeCount">
        <fieldset><legend>日期</legend><input v-model="filters.posting_date" type="date" aria-label="日期"></fieldset>
        <fieldset v-if="props.destination === 'adjustments'">
          <legend>类型</legend>
          <label><input v-model="filters.movement_kind" type="radio" value="">全部</label>
          <label><input v-model="filters.movement_kind" type="radio" value="期初库存">期初库存</label>
          <label><input v-model="filters.movement_kind" type="radio" value="盘点调整">库存盘点</label>
        </fieldset>
        <CategorySelector v-model="filters.item_groups" :rows="boot?.item_groups || []" :counts="facets.item_groups" />
        <WarehouseSelector v-if="props.destination === 'movements' && movementKind === 'Receive'" v-model="filters.destination_warehouses" :rows="warehouseRows" :counts="facets.destination_warehouses" title="入库位置" />
        <WarehouseSelector v-else-if="props.destination === 'movements' && movementKind === 'Issue'" v-model="filters.source_warehouses" :rows="warehouseRows" :counts="facets.source_warehouses" title="出库位置" />
        <template v-else-if="props.destination === 'movements'">
          <WarehouseSelector v-model="filters.source_warehouses" :rows="warehouseRows" :counts="facets.source_warehouses" title="来源位置" />
          <WarehouseSelector v-model="filters.destination_warehouses" :rows="warehouseRows" :counts="facets.destination_warehouses" title="去向位置" />
        </template>
        <WarehouseSelector v-else v-model="filters.warehouses" :rows="warehouseRows" :counts="facets.warehouses" title="位置" />
      </ResponsiveFilterPanel>
      <div class="results-column">
        <div class="results-chrome">
          <div class="result-toolbar">
            <input v-model="filters.search" type="search" placeholder="搜索记录或物品" aria-label="搜索记录或物品">
            <IconButton class="mobile-filter-button" :label="activeCount ? `筛选，已启用 ${activeCount} 项` : '筛选'" title="筛选" @click="filterPanel?.openPanel($event)"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" /></svg><span v-if="activeCount" class="icon-count">{{ activeCount }}</span></IconButton>
            <span aria-live="polite">{{ refreshing ? '正在更新…' : `已加载 ${rows.length} · 筛选结果 ${total} · 全部记录 ${overallTotal}` }}</span>
          </div>
          <ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
        </div>
        <div ref="resultsScroll" class="results-scroll">
          <SortableDataTable
            :rows="rows"
            :columns="sortColumns"
            row-key="name"
            :sort="sort"
            :loading="busy || refreshing"
            :loading-more="appending"
            :error="error"
            :empty-message="props.destination === 'drafts' ? '暂无草稿' : props.destination === 'adjustments' ? '暂无盘点调整记录' : '暂无货物流动记录'"
            @sort="sort = $event"
            @activate="activate"
          >
            <template #error>{{ error }} <button type="button" @click="load()">重试</button></template>
            <template #cell-movement_kind="{ row }">{{ row.movement_kind === '盘点调整' ? '库存盘点' : labels[row.movement_kind] || row.movement_kind }}</template>
            <template #cell-status="{ row }">{{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</template>
            <template #cell-line_count="{ row }">{{ row.line_count ?? 0 }}</template>
            <template #cell-location_count="{ row }">
              <DetailPopover :label="`查看 ${row.location_count ?? 0} 个位置`" :trigger-text="String(row.location_count ?? 0)">
                <span v-for="location in row.locations || []" :key="location.warehouse">{{ warehouseText(location.warehouse) }}<br></span>
              </DetailPopover>
            </template>
            <template #cell-category_count="{ row }">
              <DetailPopover :label="`查看 ${row.category_count ?? 0} 个类别`" :trigger-text="String(row.category_count ?? 0)">
                <span v-for="category in row.categories || []" :key="category.item_group">{{ category.item_group }}：{{ category.line_count }} 行<br></span>
              </DetailPopover>
            </template>
            <template #cell-increase_line_count="{ row }">{{ row.increase_line_count ?? 0 }}</template>
            <template #cell-decrease_line_count="{ row }">{{ row.decrease_line_count ?? 0 }}</template>
            <template #cell-actions="{ row }"><button data-row-control type="button" @click="deleteDraft(row.name)">删除草稿</button></template>
            <template #mobile-row="{ row }">
              <article class="result-card" tabindex="0">
                <RouterLink data-row-action :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${encodeURIComponent(row.name)}`">
                  <b v-if="props.destination !== 'movements'">{{ row.movement_kind === '盘点调整' ? '库存盘点' : labels[row.movement_kind] || row.movement_kind }}</b>
                  <b v-else>{{ row.posting_date }}</b>
                  <p v-if="props.destination === 'adjustments'">{{ row.posting_date }} · 增加 {{ row.increase_line_count ?? 0 }} 行 · 减少 {{ row.decrease_line_count ?? 0 }} 行</p>
                  <p v-else-if="props.destination === 'movements'">物品 {{ row.line_count ?? 0 }} 行 · 位置 {{ row.location_count ?? 0 }} 个 · 类别 {{ row.category_count ?? 0 }} 个</p>
                  <p v-else>{{ row.posting_date }} · {{ row.line_count ?? 0 }} 行</p>
                  <small>{{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</small>
                </RouterLink>
                <button v-if="props.destination === 'drafts'" data-row-control type="button" @click="deleteDraft(row.name)">删除草稿</button>
              </article>
            </template>
          </SortableDataTable>
          <div ref="sentinel" aria-hidden="true"></div>
          <div v-if="appendError" class="table-append-error" role="alert">{{ appendError }} <button type="button" @click="load(true)">重试</button></div>
        </div>
      </div>
    </div>
    <button v-if="props.destination === 'movements' && operationCaps[movementKind]" type="button" class="action-fab" :aria-label="`新建${labels[movementKind]}`" @click="operation(movementKind)">＋</button>
    <button v-else-if="props.destination === 'adjustments' && boot?.can_reconcile_stock" type="button" class="action-fab" aria-label="新建盘点调整" @click="router.push('/reconcile/new')">＋</button>
  </main>
</template>
