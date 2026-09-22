<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import CategorySelector from '../components/CategorySelector.vue'
import ItemImagePreview from '../components/ItemImagePreview.vue'
import SortableDataTable, { type SortState } from '../components/SortableDataTable.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import Scanner from '../components/Scanner.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import { hydrateFilterQuery, serializeFilterQuery } from '../composables/filters'
import { toast } from '../lib/toast'

const route = useRoute(), router = useRouter()
const boot = ref<any>(), rows = ref<any[]>([]), total = ref(0), overall = ref<number | null>(null), facetCounts = ref<any>({ warehouses: {}, item_groups: {} })
const error = ref(''), loading = ref(false), loadingMore = ref(false), filterOpen = ref(false)
const selection = ref(false), selected = ref<string[]>([]), scanner = ref(false), scanBusy = ref(false), unknownBarcodePrompt = ref('')
const resultsScroll = ref<HTMLElement>(), sentinel = ref<HTMLElement>()
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null)
const start = ref(0)
const filters = ref({ search: '', warehouses: [] as string[], item_groups: [] as string[] })
const defaultSort: SortState = { sort_by: 'item_name', sort_order: 'asc' }
const sort = ref<SortState>({ ...defaultSort })
const sortColumns = computed(() => [
  { key: 'item_name', label: '物品', sortable: true, initialOrder: 'asc' as const },
  { key: 'item_group', label: '类别' },
  { key: 'available_stock', label: '可用', sortable: true, initialOrder: 'desc' as const },
  { key: 'total_stock', label: '总计', sortable: true, initialOrder: 'desc' as const },
  { key: 'on_loan_qty', label: '借出', sortable: true, initialOrder: 'desc' as const },
  { key: 'damaged_qty', label: '损坏', sortable: true, initialOrder: 'desc' as const },
  ...(selection.value ? [{ key: 'selection', label: '选择' }] : []),
])
const mode = computed(() => String(route.query.mode || 'current'))
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const canMove = computed(() => ['Receive', 'Issue', 'Transfer', 'Loan', 'Return', 'Damage', 'Loss', 'Repair', 'Disposal'].some(kind => operationCaps.value[kind]))
const primaryActions = computed(() => ['Receive', 'Issue', 'Transfer'].filter(kind => operationCaps.value[kind]))
const modes = [{ key: 'current', label: '当前库存' }, { key: 'catalog', label: '全部物品' }, { key: 'expiry', label: '效期批次' }]
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const categoryText = (name: string) => boot.value?.item_groups?.find((row: any) => row.name === name)?.item_group_name || name
const chips = computed(() => [...filters.value.warehouses.map(value => ({ key: 'warehouses', value, label: warehouseText(value) })), ...filters.value.item_groups.map(value => ({ key: 'item_groups', value, label: categoryText(value) })), ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : [])])
let controller: AbortController | undefined, observer: IntersectionObserver | undefined, timer: ReturnType<typeof setTimeout> | undefined
let sequence = 0, syncingRoute = false
const sortQuery = () => JSON.stringify(sort.value) === JSON.stringify(defaultSort)
  ? { sort_by: undefined, sort_order: undefined }
  : { sort_by: sort.value.sort_by, sort_order: sort.value.sort_order }
async function load(append = false) { controller?.abort(); controller = new AbortController(); const current = ++sequence; append ? loadingMore.value = true : loading.value = true; error.value = ''; try { if (mode.value === 'expiry') { await router.replace({ path: '/expiry', query: { ...route.query, ...serializeFilterQuery(filters.value), ...sortQuery() } }); return } const data = await api('inventory', { ...filters.value, mode: mode.value, warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined, item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined, start: append ? rows.value.length : 0, page_length: 25, ...sort.value }, controller.signal); if (current !== sequence) return; const incoming = data.results || []; rows.value = append ? [...rows.value, ...incoming.filter((row: any) => !rows.value.some(old => old.item_code === row.item_code))] : incoming; total.value = Number(data.total || 0); overall.value = data.overall_total ?? null; facetCounts.value = data.facets || facetCounts.value } catch (cause: any) { if (cause?.name !== 'AbortError' && current === sequence) error.value = cause.message } finally { if (current === sequence) { loading.value = false; loadingMore.value = false } } }
function scheduleLoad() { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 280) }
function setMode(key: string) { if (key === 'expiry') void router.push({ path: '/expiry', query: { ...serializeFilterQuery(filters.value) } }); else void router.replace({ query: { ...route.query, mode: key === 'current' ? undefined : key, expiry_window: undefined, expiry_days: undefined, start: undefined } }) }
function removeChip(chip: any) { if (chip.key === 'warehouses' || chip.key === 'item_groups') (filters.value as any)[chip.key] = (filters.value as any)[chip.key].filter((value: string) => value !== chip.value); else filters.value.search = '' }
function clearFilters() { filters.value = { search: '', warehouses: [], item_groups: [] } }
function operation(kind: string) { void router.push(`/new/${kind}`) }
function selectedOperation(kind: string) { if (!selected.value.length) return operation(kind); sessionStorage.setItem(`ti-seed:${kind}`, JSON.stringify({ items: selected.value })); operation(kind) }
function toggle(code: string) { selected.value = selected.value.includes(code) ? selected.value.filter(value => value !== code) : [...selected.value, code] }
function toggleSelection() {
  if (selection.value && selected.value.length && !window.confirm(`将放弃已选的 ${selected.value.length} 项物品，确定继续吗？`)) return
  selection.value = !selection.value
  if (!selection.value) selected.value = []
}
function applySort(value: SortState) { sort.value = value; rows.value = []; start.value = 0; observer?.disconnect(); if (sentinel.value) observer?.observe(sentinel.value) }
async function scan(value: string) { if (scanBusy.value) return; scanBusy.value = true; try { const result = await api('scan', { value }); scanner.value = false; if (result.item_code) await router.push(`/item/${encodeURIComponent(result.item_code)}`); else unknownBarcodePrompt.value = value } catch (cause: any) { error.value = cause.message || '条码查询失败' } finally { scanBusy.value = false } }
async function createUnknownItem() { const value = unknownBarcodePrompt.value; unknownBarcodePrompt.value = ''; sessionStorage.setItem('ti-unknown-barcode', value); await router.push('/new/Receive') }
function dismissUnknownItem() { unknownBarcodePrompt.value = ''; toast('未找到该条码对应的物品', 'warning') }
watch([filters, mode, sort], () => { if (!boot.value) return; resultsScroll.value?.scrollTo({ top: 0 }); if (!syncingRoute) { syncingRoute = true; void router.replace({ query: { ...route.query, mode: mode.value === 'current' ? undefined : mode.value, ...serializeFilterQuery(filters.value), ...sortQuery() } }).finally(() => { syncingRoute = false }) } scheduleLoad() }, { deep: true })
watch(() => route.query, query => { const next = hydrateFilterQuery(query as Record<string, unknown>, filters.value); if (JSON.stringify(next) !== JSON.stringify(filters.value)) filters.value = next; const sortBy = String(query.sort_by || defaultSort.sort_by), sortOrder = String(query.sort_order || defaultSort.sort_order); if (['item_name', 'available_stock', 'total_stock', 'on_loan_qty', 'damaged_qty'].includes(sortBy) && ['asc', 'desc'].includes(sortOrder) && (sort.value.sort_by !== sortBy || sort.value.sort_order !== sortOrder)) sort.value = { sort_by: sortBy, sort_order: sortOrder as 'asc' | 'desc' } }, { deep: true })
onMounted(async () => { try { boot.value = await api('bootstrap'); filters.value = hydrateFilterQuery(route.query as Record<string, unknown>, filters.value); const sortBy = String(route.query.sort_by || defaultSort.sort_by), sortOrder = String(route.query.sort_order || defaultSort.sort_order); if (['item_name', 'available_stock', 'total_stock', 'on_loan_qty', 'damaged_qty'].includes(sortBy) && ['asc', 'desc'].includes(sortOrder)) sort.value = { sort_by: sortBy, sort_order: sortOrder as 'asc' | 'desc' }; await load(); await nextTick(); const saved = Number(sessionStorage.getItem('ti:inventory-results-scroll') || 0); if (saved) resultsScroll.value?.scrollTo({ top: saved }); observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && rows.value.length < total.value && !loadingMore.value && !loading.value) void load(true) }, { root: resultsScroll.value, rootMargin: '240px' }); if (sentinel.value) observer.observe(sentinel.value) } catch (cause: any) { error.value = cause.message } })
onBeforeUnmount(() => { if (timer) clearTimeout(timer); sessionStorage.setItem('ti:inventory-results-scroll', String(resultsScroll.value?.scrollTop || 0)); controller?.abort(); observer?.disconnect() })
</script>
<template>
  <section class="inventory-destination wide-shell viewport-list-root">
    <nav class="inventory-modes mobile-inventory-modes" aria-label="库存视图"><button v-for="item in modes" :key="item.key" type="button"
        :class="{ active: mode === item.key }" @click="setMode(item.key)">{{ item.label }}</button></nav>
    <div class="list-layout desktop-list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen">
        <WarehouseSelector v-model="filters.warehouses" :rows="warehouseRows" :counts="facetCounts.warehouses" />
        <CategorySelector v-model="filters.item_groups" :rows="boot?.item_groups || []" :counts="facetCounts.item_groups" />
      </ResponsiveFilterPanel>
      <div class="results-column">
        <div class="results-chrome"><div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索物品或条码"
            aria-label="搜索物品或条码"><button type="button" aria-label="扫描条码" @click="scanner = true">扫描</button><button
            class="mobile-filter-button" type="button" @click="filterPanel?.openPanel($event)">筛选</button><button type="button"
            @click="toggleSelection">{{ selection ? '完成选择' : '选择' }}</button><span aria-live="polite">已加载 {{ rows.length
            }} · 筛选结果 {{ total }} · 全部 {{ overall ?? total }}</span></div><ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" /></div>
        <div ref="resultsScroll" class="results-scroll"><p v-if="error" class="error">{{ error }} <button type="button" @click="load()">重试</button></p>
        <LoadingIndicator v-if="loading" text="正在加载库存…" />
        <div v-else class="inventory-results">
          <SortableDataTable :rows="rows" :columns="sortColumns" row-key="item_code" :sort="sort" :selection-mode="selection" :selected-keys="selected" @sort="applySort" @activate="item => router.push(`/item/${encodeURIComponent(item.item_code)}`)" @toggle="item => toggle(item.item_code)">
            <template #cell-item_name="{ row }"><div class="primary-cell"><span data-row-control><ItemImagePreview :src="row.image" :alt="row.item_name" /></span><RouterLink data-row-action :to="`/item/${encodeURIComponent(row.item_code)}`"><b class="primary-text">{{ row.item_name }}</b><small class="secondary-text">{{ row.item_code }}</small></RouterLink></div></template>
            <template #cell-available_stock="{ row }"><span class="quantity available-quantity"><b>{{ row.available_stock }} {{ row.stock_uom }}</b></span></template>
            <template #cell-total_stock="{ row }"><span class="quantity">{{ row.total_stock }} {{ row.stock_uom }}</span></template>
            <template #cell-on_loan_qty="{ row }"><span class="quantity">{{ row.on_loan_qty }} {{ row.stock_uom }}</span></template>
            <template #cell-damaged_qty="{ row }"><span class="quantity">{{ row.damaged_qty }} {{ row.stock_uom }}</span></template>
            <template #cell-selection="{ row }"><input data-row-control type="checkbox" :checked="selected.includes(row.item_code)" :aria-label="`选择 ${row.item_name}`" @change="toggle(row.item_code)"></template>
            <template #mobile-row="{ row }"><article class="item-card" tabindex="0"><span data-row-control><ItemImagePreview :src="row.image" :alt="row.item_name" /></span><RouterLink data-row-action :to="`/item/${encodeURIComponent(row.item_code)}`"><b>{{ row.item_name }}</b><small>{{ row.item_code }} · {{ row.item_group }}</small><strong class="available-quantity">可用 {{ row.available_stock }} {{ row.stock_uom }}</strong><small>总计 {{ row.total_stock }} {{ row.stock_uom }}</small></RouterLink><input v-if="selection" data-row-control type="checkbox" :checked="selected.includes(row.item_code)" :aria-label="`选择 ${row.item_name}`" @change="toggle(row.item_code)"></article></template>
          </SortableDataTable>
          <p v-if="!rows.length" class="empty-state">暂无符合条件的物品</p>
        </div>
        <div ref="sentinel" aria-hidden="true"></div><button v-if="rows.length < total" type="button"
          :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '正在加载…' : '加载更多' }}</button></div>
      </div>
    </div>
    <div v-if="selection && selected.length" class="context-action-bar" role="toolbar" aria-label="已选物品操作"><span>已选 {{
      selected.length }} 项</span><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan']"
        :key="kind"><button v-if="operationCaps[kind]" type="button" @click="selectedOperation(kind)">{{ ({
          Receive:
            '入库', Issue: '出库', Transfer: '转移', Loan: '借出'
        } as any)[kind] }}</button></template>
    </div>
    <FloatingActionMenu v-if="canMove"
      :actions="primaryActions.map(kind => ({ kind, label: ({ Receive: '入库', Issue: '出库', Transfer: '转移' } as any)[kind] }))"
      @select="operation" />
    <Scanner v-if="scanner" presentation="modal" :paused="scanBusy" @scan="scan" @close="scanner = false" />
    <div v-if="unknownBarcodePrompt" class="modal" role="presentation" @click.self="dismissUnknownItem">
      <section role="dialog" aria-modal="true" aria-labelledby="unknown-barcode-title">
        <h2 id="unknown-barcode-title">未找到物品</h2>
        <p>没有找到条码 {{ unknownBarcodePrompt }} 对应的物品。要现在新建物品吗？</p>
        <div class="detail-actions"><button type="button" @click="dismissUnknownItem">取消</button><button type="button"
            class="primary" @click="createUnknownItem">新建物品</button></div>
      </section>
    </div>
  </section>
</template>
