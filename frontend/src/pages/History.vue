<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Combobox } from 'frappe-ui'
import { api, labels, workspaceApi } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from '../composables/filters'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'
import SortableDataTable, { type SortState } from '../components/SortableDataTable.vue'
import { returnToOpener } from '../lib/navigation'

const route = useRoute()
const router = useRouter()
const boot = ref<any>()
const rows = ref<any[]>([])
const total = ref(0)
const overallTotal = ref(0)
const unfinishedCount = ref(0)
const facets = ref<Record<string, Record<string, number>>>({ movement_kind: {}, warehouses: {}, item_groups: {} })
const start = ref(0)
const error = ref('')
const busy = ref(true)
const refreshing = ref(false)
const activities = ref<any[]>([])
const filterOpen = ref(false)
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null)
const sentinel = ref<HTMLElement>()
const resultsScroll = ref<HTMLElement>()
const scrollKey = 'temple_inventory.scroll.movements'
const pageLength = 25
const defaultSort: SortState = { sort_by: 'posting_date', sort_order: 'desc' }
const sort = ref<SortState>({ ...defaultSort })
const sortColumns = [
  { key: 'title', label: '类型 / 描述', sortable: true, initialOrder: 'asc' as const },
  { key: 'posting_date', label: '日期', sortable: true, initialOrder: 'desc' as const },
  { key: 'source', label: '来源' },
  { key: 'line_count', label: '物品行数', sortable: true, initialOrder: 'desc' as const },
  { key: 'status', label: '状态' },
  { key: 'actions', label: '操作' },
]
const statusGroup = ref(route.query.status === 'unfinished' ? 'unfinished' : 'completed')
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const canMove = computed(() => ['Receive', 'Issue', 'Transfer', 'Loan', 'Return', 'Damage', 'Loss', 'Repair', 'Disposal'].some(kind => operationCaps.value[kind]))
const movementActions = computed(() => ['Receive', 'Issue', 'Transfer'].filter(kind => operationCaps.value[kind]).map(kind => ({ kind, label: labels[kind] })))
const primaryKinds = ['Receive', 'Issue', 'Transfer', '盘点调整']
const filters = ref({
  search: '',
  movement_kind: '',
  date_from: '',
  date_to: '',
  source_text: '',
  purpose_text: '',
  activity: '',
  handler_name: '',
  rooms: [] as string[],
})

const activityTypeLabel = (value: string) =>
  ({ Distribution: '分发', Event: '活动', Performance: '演出', 'Religious Activity': '宗教活动', Maintenance: '维护', Other: '其他' } as Record<string, string>)[value] || value
const activityOptions = computed(() => activities.value.map(activity => ({
  label: `${activity.title}（${activityTypeLabel(activity.activity_type)}）`,
  value: activity.name,
})))
const activeCount = computed(() => Object.values(filters.value).reduce((count, value) => count + (Array.isArray(value) ? value.length : value ? 1 : 0), 0))
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const chips = computed(() => [
  ...filters.value.rooms.map(value => ({ key: 'rooms', value, label: warehouseText(value) })),
  ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : []),
  ...(filters.value.movement_kind ? [{ key: 'movement_kind', label: labels[filters.value.movement_kind] || filters.value.movement_kind }] : []),
  ...(filters.value.date_from ? [{ key: 'date_from', label: `开始：${filters.value.date_from}` }] : []),
  ...(filters.value.date_to ? [{ key: 'date_to', label: `结束：${filters.value.date_to}` }] : []),
  ...(filters.value.source_text ? [{ key: 'source_text', label: `来源：${filters.value.source_text}` }] : []),
  ...(filters.value.purpose_text ? [{ key: 'purpose_text', label: `用途：${filters.value.purpose_text}` }] : []),
  ...(filters.value.activity ? [{ key: 'activity', label: `活动：${activityOptions.value.find(option => option.value === filters.value.activity)?.label || filters.value.activity}` }] : []),
  ...(filters.value.handler_name ? [{ key: 'handler_name', label: `经手人：${filters.value.handler_name}` }] : []),
])

function removeChip(chip: any) {
  if (chip.key === 'rooms') filters.value.rooms = filters.value.rooms.filter(value => value !== chip.value)
  else (filters.value as any)[chip.key] = ''
}
function clearAll() {
  filters.value = { search: '', movement_kind: '', date_from: '', date_to: '', source_text: '', purpose_text: '', activity: '', handler_name: '', rooms: [] }
  start.value = 0
  resultsScroll.value?.scrollTo({ top: 0 })
}
function operation(kind: string) { void router.push(`/new/${kind}`) }

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let sequence = 0
let syncingRoute = false
let restoringRoute = false
let previousText = ''
let observer: IntersectionObserver | undefined
function queryState() {
  const sortQuery = JSON.stringify(sort.value) === JSON.stringify(defaultSort) ? {} : sort.value
  return { ...filters.value, start: start.value || undefined, status: statusGroup.value === 'unfinished' ? 'unfinished' : undefined, ...sortQuery }
}
async function load(offset = start.value, debounceText = false, append = false) {
  if (timer) clearTimeout(timer)
  controller?.abort()
  const current = ++sequence
  controller = new AbortController()
  start.value = Math.max(0, offset)
  const run = async () => {
    refreshing.value = rows.value.length > 0
    busy.value = rows.value.length === 0
    error.value = ''
    try {
      const data = await workspaceApi('history', {
        filters: { ...filters.value, rooms: filters.value.rooms.length ? filters.value.rooms : undefined },
        start: start.value,
        page_length: pageLength,
        status_group: statusGroup.value,
        ...sort.value,
      }, controller?.signal)
      if (current !== sequence) return
      rows.value = append ? [...rows.value, ...(data.results || []).filter((row: any) => !rows.value.some(old => old.name === row.name))] : (data.results || [])
      total.value = data.total || 0
		overallTotal.value = data.overall_total || 0
      unfinishedCount.value = data.unfinished_count || 0
      facets.value = data.facets || { movement_kind: {}, warehouses: {}, item_groups: {} }
      syncingRoute = true
      await router.replace({ query: { ...route.query, sort_by: undefined, sort_order: undefined, ...serializeFilterQuery(queryState()) } })
      syncingRoute = false
    } catch (cause: any) {
      syncingRoute = false
      if (current === sequence && cause?.name !== 'AbortError') error.value = cause.message
    } finally {
      if (current === sequence) {
        busy.value = false
        refreshing.value = false
      }
    }
  }
  if (debounceText) timer = setTimeout(() => void run(), 300)
  else await run()
}

async function selectGroup(group: string) {
  statusGroup.value = group
  if (group === 'unfinished') filters.value.movement_kind = ''
  else if (!filters.value.movement_kind) filters.value.movement_kind = 'Receive'
  start.value = 0
  resultsScroll.value?.scrollTo({ top: 0 })
  await router.replace({ query: { ...route.query, sort_by: undefined, sort_order: undefined, ...serializeFilterQuery(queryState()) } })
  void load(0)
}
function applyQuery(query: Record<string, unknown>) {
  const hydrated = hydrateFilterQuery(query, {
    search: '', movement_kind: '', date_from: '', date_to: '', source_text: '', purpose_text: '', activity: '', handler_name: '', rooms: [] as string[], start: '0',
  })
  const next = {
    search: String(hydrated.search || ''), movement_kind: String(hydrated.movement_kind || ''), date_from: String(hydrated.date_from || ''),
    date_to: String(hydrated.date_to || ''), source_text: String(hydrated.source_text || ''), purpose_text: String(hydrated.purpose_text || ''),
    activity: String(hydrated.activity || ''), handler_name: String(hydrated.handler_name || ''), rooms: hydrated.rooms as string[],
  }
  const requestedSort = String(query.sort_by || '')
  const requestedOrder = String(query.sort_order || '')
  const validSort = ['title', 'posting_date', 'line_count'].includes(requestedSort) && ['asc', 'desc'].includes(requestedOrder)
  const nextSort = validSort ? { sort_by: requestedSort, sort_order: requestedOrder } as SortState : { ...defaultSort }
  const changed = Object.keys(next).some(key => !sameFilterValue((filters.value as any)[key], (next as any)[key]))
  const nextStatus = query.status === 'unfinished' ? 'unfinished' : 'completed'
  const nextStart = Number(hydrated.start) || 0
  const sortChanged = sort.value.sort_by !== nextSort.sort_by || sort.value.sort_order !== nextSort.sort_order
  if (!changed && nextStatus === statusGroup.value && start.value === nextStart && !sortChanged) return false
  restoringRoute = true
  filters.value = next
  previousText = [next.search, next.source_text, next.purpose_text, next.handler_name].join("\u0000")
  statusGroup.value = nextStatus
  start.value = nextStart
  sort.value = nextSort
  void nextTick(() => { restoringRoute = false })
  return true
}

watch(filters, () => {
  if (!boot.value || restoringRoute) return
  const text = [filters.value.search, filters.value.source_text, filters.value.purpose_text, filters.value.handler_name].join('\u0000')
  const debounceText = text !== previousText
  previousText = text
  start.value = 0
  resultsScroll.value?.scrollTo({ top: 0 })
  void load(0, debounceText)
}, { deep: true })
watch(sort, () => {
  if (!boot.value || restoringRoute) return
  start.value = 0
  rows.value = []
  resultsScroll.value?.scrollTo({ top: 0 })
  void load(0)
}, { deep: true })
watch(() => route.query, query => {
  if (!syncingRoute && applyQuery(query as Record<string, unknown>)) void load(start.value)
}, { deep: true })

onMounted(async () => {
  try {
    boot.value = await api('bootstrap')
    activities.value = await workspaceApi('activities')
    applyQuery(route.query as Record<string, unknown>)
    await load(start.value)
    await nextTick()
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && rows.value.length < total.value && !busy.value) void load(rows.value.length, false, true)
    }, { root: resultsScroll.value, rootMargin: '240px' })
    if (sentinel.value) observer.observe(sentinel.value)
    const saved = Number(sessionStorage.getItem(scrollKey) || 0)
    if (saved) resultsScroll.value?.scrollTo({ top: saved })
  } catch (cause: any) {
    error.value = cause.message
  }
})
onBeforeUnmount(() => { controller?.abort(); observer?.disconnect(); if (resultsScroll.value) sessionStorage.setItem(scrollKey, String(resultsScroll.value.scrollTop)) })
function activate(row: any) {
  const path = row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`
  void router.push(path)
}
function close() { void returnToOpener(router, '/more') }
async function deleteDraft(name: string) {
  if (!window.confirm('确定删除这条未完成记录吗？此操作无法撤销。')) return
  try {
    await workspaceApi('delete_draft', { name })
    window.dispatchEvent(new Event('ti:refresh-shell'))
    await returnToOpener(router, '/movements?status=unfinished')
  } catch (cause: any) { error.value = cause.message }
}
</script>

<template>
  <main class="app-shell wide-shell viewport-list-root">
    <header class="browse-back"><button type="button" @click="close">‹ 更多</button></header>
    <nav class="toolbar movement-modes" aria-label="货物流动类型"><button v-for="kind in primaryKinds" :key="kind" type="button" :class="{ primary: filters.movement_kind === kind }" @click="filters.movement_kind = kind; statusGroup = 'completed'">{{ labels[kind] }}<b v-if="facets.movement_kind[kind]">（{{ facets.movement_kind[kind] }}）</b></button><button v-if="boot?.can_reconcile_stock" type="button" @click="router.push('/reconcile/new')">盘点</button><button type="button" :class="{ primary: statusGroup === 'unfinished' }" @click="selectGroup('unfinished')">草稿 <b v-if="unfinishedCount">{{ unfinishedCount }}</b></button></nav>
    <div class="list-layout desktop-list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen" :count="activeCount">
        <WarehouseSelector v-model="filters.rooms" :rows="warehouseRows" :counts="facets.warehouses" />
        <fieldset><legend>日期</legend><label>开始日期<input v-model="filters.date_from" type="date"></label><label>结束日期<input v-model="filters.date_to" type="date"></label></fieldset>
        <fieldset><legend>记录详情</legend><label>来源<input v-model="filters.source_text" placeholder="包含文字"></label><label>用途<input v-model="filters.purpose_text" placeholder="包含文字"></label><label>活动<Combobox v-model="filters.activity" :options="activityOptions" placeholder="搜索活动" aria-label="搜索活动" /></label><label>经手人<input v-model="filters.handler_name" placeholder="按姓名筛选"></label></fieldset>
      </ResponsiveFilterPanel>
      <div class="results-column">
        <div class="results-chrome"><div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索记录、来源、物品…" aria-label="搜索记录、来源、物品"><button class="mobile-filter-button" type="button" @click="filterPanel?.openPanel($event)">筛选<span v-if="activeCount">（{{ activeCount }}）</span></button><span aria-live="polite">{{ refreshing ? '正在更新…' : `已加载 ${rows.length} · 筛选结果 ${total} · 全部记录 ${overallTotal}` }}</span></div><ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" /></div>
        <div ref="resultsScroll" class="results-scroll"><p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load(start)">重试</button></p>
        <LoadingIndicator v-if="busy && !rows.length" text="正在加载记录…" />
        <template v-else>
          <SortableDataTable :rows="rows" :columns="sortColumns" row-key="name" :sort="sort" @sort="value => { sort = value }" @activate="activate">
            <template #cell-title="{ row }"><RouterLink data-row-action :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`"><b>{{ labels[row.movement_kind] || row.movement_kind }} · {{ row.source_text || row.purpose_text || row.activity || row.name }}</b></RouterLink></template>
            <template #cell-source="{ row }">{{ row.document_type === 'Stock Reconciliation' ? 'ERPNext · 盘点' : row.legacy ? 'ERPNext' : '本应用' }}</template>
            <template #cell-status="{ row }">{{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</template>
            <template #cell-line_count="{ row }">{{ row.line_count ?? row.items?.length ?? 0 }}</template>
            <template #cell-actions="{ row }"><button v-if="statusGroup === 'unfinished'" data-row-control type="button" @click="deleteDraft(row.name)">删除草稿</button></template>
            <template #mobile-row="{ row }"><article tabindex="0"><RouterLink data-row-action :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`"><b>{{ labels[row.movement_kind] || row.movement_kind }} · {{ row.source_text || row.purpose_text || row.activity || row.name }}</b><p>{{ row.posting_date }} · {{ row.line_count ?? row.items?.length ?? 0 }} 行 · {{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</p><small>{{ row.handler_name || row.responsible_person }}</small></RouterLink><button v-if="statusGroup === 'unfinished'" data-row-control type="button" @click="deleteDraft(row.name)">删除草稿</button></article></template>
          </SortableDataTable>
          <p v-if="!rows.length" class="empty-state">{{ statusGroup === 'unfinished' ? '暂无未完成记录' : '暂无库存记录' }}</p>
        </template>
        <div ref="sentinel" aria-hidden="true"></div><button v-if="rows.length < total" type="button" :disabled="busy" @click="load(rows.length, false, true)">{{busy?'正在加载…':'加载更多'}}</button></div>
      </div>
    </div>
    <FloatingActionMenu v-if="canMove || boot?.can_reconcile_stock" :actions="[...movementActions, ...(boot?.can_reconcile_stock ? [{ kind: 'Reconcile', label: '盘点' }] : [])]" @select="kind => kind === 'Reconcile' ? router.push('/reconcile/new') : operation(kind)"/>
  </main>
</template>
