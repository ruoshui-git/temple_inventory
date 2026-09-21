<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Combobox } from 'frappe-ui'
import { api, labels, warehouseLabelContract, workspaceApi } from '../lib/api'
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from '../composables/filters'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import HierarchyAutocomplete from '../components/HierarchyAutocomplete.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'

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
const resultsPane = ref<HTMLElement>()
const scrollKey = 'temple_inventory.scroll.movements'
const pageLength = 25
const statusGroup = ref(route.query.status === 'unfinished' ? 'unfinished' : 'completed')
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const canMove = computed(() => ['Receive', 'Issue', 'Transfer', 'Loan', 'Return', 'Damage', 'Loss', 'Repair', 'Disposal'].some(kind => operationCaps.value[kind]))
const movementActions = computed(() => ['Receive', 'Issue', 'Transfer'].filter(kind => operationCaps.value[kind]).map(kind => ({ kind, label: labels[kind] })))
const primaryKinds = ['Receive', 'Issue', 'Transfer', '盘点调整']
const specialKinds = ['Damage', 'Loss', 'Repair', 'Disposal', 'Loan', 'Return']
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
const warehouseText = (name: string) => warehouseLabelContract(name, boot.value?.warehouse_tree || []).full_label
const warehouseOptions = computed(() => (boot.value?.physical_tree || []).map((row: any) => ({ ...row, label: warehouseLabelContract(row.name, boot.value?.warehouse_tree || []).full_label, search_text: warehouseLabelContract(row.name, boot.value?.warehouse_tree || []).search_text, parent: row.parent_warehouse })))
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
  resultsPane.value?.scrollTo({ top: 0 })
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
  return { ...filters.value, start: start.value || undefined, status: statusGroup.value === 'unfinished' ? 'unfinished' : undefined }
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
      }, controller?.signal)
      if (current !== sequence) return
      rows.value = append ? [...rows.value, ...(data.results || []).filter((row: any) => !rows.value.some(old => old.name === row.name))] : (data.results || [])
      total.value = data.total || 0
		overallTotal.value = data.overall_total || 0
      unfinishedCount.value = data.unfinished_count || 0
      facets.value = data.facets || { movement_kind: {}, warehouses: {}, item_groups: {} }
      syncingRoute = true
      await router.replace({ query: { ...route.query, ...serializeFilterQuery(queryState()) } })
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
  await router.replace({ query: { ...route.query, ...serializeFilterQuery(queryState()) } })
  void load(0)
}
async function deleteDraft(name: string) {
  if (!window.confirm('确定删除这条未完成记录吗？此操作无法撤销。')) return
  try { await workspaceApi('delete_draft', { name }); window.dispatchEvent(new Event('ti:refresh-shell')); await load() } catch (cause: any) { error.value = cause.message }
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
  const changed = Object.keys(next).some(key => !sameFilterValue((filters.value as any)[key], (next as any)[key]))
  const nextStatus = query.status === 'unfinished' ? 'unfinished' : 'completed'
  const nextStart = Number(hydrated.start) || 0
  if (!changed && nextStatus === statusGroup.value && start.value === nextStart) return false
  restoringRoute = true
  filters.value = next
  previousText = [next.search, next.source_text, next.purpose_text, next.handler_name].join("\u0000")
  statusGroup.value = nextStatus
  start.value = nextStart
  void nextTick(() => { restoringRoute = false })
  return true
}

watch(filters, () => {
  if (!boot.value || restoringRoute) return
  const text = [filters.value.search, filters.value.source_text, filters.value.purpose_text, filters.value.handler_name].join('\u0000')
  const debounceText = text !== previousText
  previousText = text
  start.value = 0
  void load(0, debounceText)
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
  <main class="app-shell wide-shell">
    <header class="browse-back"><RouterLink to="/more">‹ 更多</RouterLink></header>
    <nav class="toolbar movement-modes" aria-label="货物流动类型"><button v-for="kind in primaryKinds" :key="kind" type="button" :class="{ primary: filters.movement_kind === kind }" @click="filters.movement_kind = kind; statusGroup = 'completed'">{{ labels[kind] }}<b v-if="facets.movement_kind[kind]">（{{ facets.movement_kind[kind] }}）</b></button><button v-if="boot?.can_reconcile_stock" type="button" @click="router.push('/reconcile/new')">盘点</button><button type="button" :class="{ primary: statusGroup === 'unfinished' }" @click="selectGroup('unfinished')">草稿 <b v-if="unfinishedCount">{{ unfinishedCount }}</b></button></nav>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load(start)">重试</button></p>
    <div class="list-layout desktop-list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen" :count="activeCount">
        <HierarchyAutocomplete v-model="filters.rooms" title="仓库 / 位置" placeholder="搜索或浏览仓库 / 位置" :options="warehouseOptions" :tree="warehouseOptions" />
        <fieldset><legend>交易类型</legend><label v-for="kind in primaryKinds" :key="kind"><input v-model="filters.movement_kind" type="radio" :value="kind">{{ labels[kind] }}</label><label v-if="specialKinds.includes(filters.movement_kind)">其他类型<select v-model="filters.movement_kind"><option value="">全部类型</option><option v-for="kind in specialKinds" :key="kind" :value="kind">{{ labels[kind] }}</option></select></label><label v-else>其他类型<select aria-label="其他类型" @change="filters.movement_kind = ($event.target as HTMLSelectElement).value"><option value="">选择特殊类型</option><option v-for="kind in specialKinds" :key="kind" :value="kind">{{ labels[kind] }}</option></select></label></fieldset>
        <fieldset><legend>日期</legend><label>开始日期<input v-model="filters.date_from" type="date"></label><label>结束日期<input v-model="filters.date_to" type="date"></label></fieldset>
        <fieldset><legend>记录详情</legend><label>来源<input v-model="filters.source_text" placeholder="包含文字"></label><label>用途<input v-model="filters.purpose_text" placeholder="包含文字"></label><label>活动<Combobox v-model="filters.activity" :options="activityOptions" placeholder="搜索活动" aria-label="搜索活动" /></label><label>经手人<input v-model="filters.handler_name" placeholder="按姓名筛选"></label></fieldset>
      </ResponsiveFilterPanel>
      <div ref="resultsPane" class="results-column">
        <div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索记录、来源、物品…" aria-label="搜索记录、来源、物品"><button class="mobile-filter-button" type="button" @click="filterPanel?.openPanel($event)">筛选<span v-if="activeCount">（{{ activeCount }}）</span></button><span aria-live="polite">{{ refreshing ? '正在更新…' : `已加载 ${rows.length} · 筛选结果 ${total} · 全部记录 ${overallTotal}` }}</span></div>
        <ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
        <LoadingIndicator v-if="busy && !rows.length" text="正在加载记录…" />
        <template v-else>
          <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th scope="col">类型 / 描述</th><th scope="col">日期</th><th scope="col">来源</th><th scope="col">物品行数</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.name"><td><RouterLink :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`"><b>{{ labels[row.movement_kind] || row.movement_kind }} · {{ row.source_text || row.purpose_text || row.activity || row.name }}</b></RouterLink></td><td>{{ row.posting_date }}</td><td>{{ row.document_type === 'Stock Reconciliation' ? 'ERPNext · 盘点' : row.legacy ? 'ERPNext' : '本应用' }}</td><td>{{ row.items?.length || 0 }}</td><td>{{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</td><td><button v-if="statusGroup === 'unfinished'" type="button" @click="deleteDraft(row.name)">删除草稿</button></td></tr></tbody></table></div>
          <div class="mobile-cards"><article v-for="row in rows" :key="row.name" class="selection-row"><RouterLink :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`"><b>{{ labels[row.movement_kind] || row.movement_kind }} · {{ row.source_text || row.purpose_text || row.activity || row.name }}</b><p>{{ row.posting_date }} · {{ row.items?.length || 0 }} 行 · {{ row.docstatus === 0 ? '编辑中' : row.docstatus === 1 ? '已完成' : '已取消' }}</p><small>{{ row.handler_name || row.responsible_person }}</small></RouterLink><button v-if="statusGroup === 'unfinished'" type="button" @click="deleteDraft(row.name)">删除草稿</button></article></div>
          <p v-if="!rows.length" class="empty-state">{{ statusGroup === 'unfinished' ? '暂无未完成记录' : '暂无库存记录' }}</p>
        </template>
        <div ref="sentinel" aria-hidden="true"></div><button v-if="rows.length < total" type="button" :disabled="busy" @click="load(rows.length, false, true)">{{busy?'正在加载…':'加载更多'}}</button>
      </div>
    </div>
    <FloatingActionMenu v-if="canMove || boot?.can_reconcile_stock" :actions="[...movementActions, ...(boot?.can_reconcile_stock ? [{ kind: 'Reconcile', label: '盘点' }] : [])]" @select="kind => kind === 'Reconcile' ? router.push('/reconcile/new') : operation(kind)"/>
  </main>
</template>
