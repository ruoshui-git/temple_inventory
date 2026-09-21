<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import HierarchyAutocomplete from '../components/HierarchyAutocomplete.vue'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import ItemImagePreview from '../components/ItemImagePreview.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import Scanner from '../components/Scanner.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'
import { hydrateFilterQuery, serializeFilterQuery } from '../composables/filters'
import { toast } from '../lib/toast'

const route = useRoute(), router = useRouter()
const boot = ref<any>(), rows = ref<any[]>([]), total = ref(0), overall = ref<number | null>(null), facetCounts = ref<any>({ warehouses: {}, item_groups: {} })
const error = ref(''), loading = ref(false), loadingMore = ref(false), filterOpen = ref(false)
const selection = ref(false), selected = ref<string[]>([]), scanner = ref(false), unknownBarcodePrompt = ref('')
const resultsPane = ref<HTMLElement>(), sentinel = ref<HTMLElement>(), filterInvoker = ref<HTMLElement>()
const filters = ref({ search: '', warehouses: [] as string[], item_groups: [] as string[] })
const mode = computed(() => String(route.query.mode || 'current'))
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const canMove = computed(() => ['Receive', 'Issue', 'Transfer', 'Loan', 'Return', 'Damage', 'Loss', 'Repair', 'Disposal'].some(kind => operationCaps.value[kind]))
const primaryActions = computed(() => ['Receive', 'Issue', 'Transfer'].filter(kind => operationCaps.value[kind]))
const modes = [{ key: 'current', label: '当前库存' }, { key: 'catalog', label: '全部物品' }, { key: 'expiry', label: '效期批次' }]
const categoryOptions = computed(() => (boot.value?.item_groups || []).filter((row: any) => row.parent_item_group).map((row: any) => ({ ...row, count: facetCounts.value.item_groups[row.name], label: row.item_group_name, parent: row.parent_item_group })))
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const chips = computed(() => [...filters.value.warehouses.map(value => ({ key: 'warehouses', value, label: warehouseText(value) })), ...filters.value.item_groups.map(value => ({ key: 'item_groups', value, label: categoryOptions.value.find((row: any) => row.name === value)?.label || value })), ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : [])])
let controller: AbortController | undefined, observer: IntersectionObserver | undefined, timer: ReturnType<typeof setTimeout> | undefined
let sequence = 0, syncingRoute = false
watch(filterOpen, value => { if (value && document.activeElement instanceof HTMLElement) filterInvoker.value = document.activeElement; document.body.style.overflow = value ? 'hidden' : ''; if (!value) void nextTick(() => filterInvoker.value?.focus()) })
async function load(append = false) { controller?.abort(); controller = new AbortController(); const current = ++sequence; append ? loadingMore.value = true : loading.value = true; error.value = ''; try { if (mode.value === 'expiry') { await router.replace({ path: '/expiry', query: { ...route.query, ...serializeFilterQuery(filters.value) } }); return } const data = await api('inventory', { ...filters.value, mode: mode.value, warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined, item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined, start: append ? rows.value.length : 0, page_length: 25 }, controller.signal); if (current !== sequence) return; const incoming = data.results || []; rows.value = append ? [...rows.value, ...incoming.filter((row: any) => !rows.value.some(old => old.item_code === row.item_code))] : incoming; total.value = Number(data.total || 0); overall.value = data.overall_total ?? null; facetCounts.value = data.facets || facetCounts.value } catch (cause: any) { if (cause?.name !== 'AbortError' && current === sequence) error.value = cause.message } finally { if (current === sequence) { loading.value = false; loadingMore.value = false } } }
function scheduleLoad() { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 280) }
function setMode(key: string) { if (key === 'expiry') void router.push({ path: '/expiry', query: { ...route.query, ...serializeFilterQuery(filters.value) } }); else void router.replace({ query: { ...route.query, mode: key === 'current' ? undefined : key } }) }
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
async function scan(value: string) { const result = await api('scan', { value }); if (result.item_code) await router.push(`/item/${encodeURIComponent(result.item_code)}`); else unknownBarcodePrompt.value = value }
async function createUnknownItem() { const value = unknownBarcodePrompt.value; unknownBarcodePrompt.value = ''; sessionStorage.setItem('ti-unknown-barcode', value); await router.push('/new/Receive') }
function dismissUnknownItem() { unknownBarcodePrompt.value = ''; toast('未找到该条码对应的物品', 'warning') }
watch([filters, mode], () => { if (!boot.value) return; resultsPane.value?.scrollTo({ top: 0 }); if (!syncingRoute) { syncingRoute = true; void router.replace({ query: { ...route.query, mode: mode.value === 'current' ? undefined : mode.value, ...serializeFilterQuery(filters.value) } }).finally(() => { syncingRoute = false }) } scheduleLoad() }, { deep: true })
watch(() => route.query, query => { const next = hydrateFilterQuery(query as Record<string, unknown>, filters.value); if (JSON.stringify(next) !== JSON.stringify(filters.value)) filters.value = next }, { deep: true })
onMounted(async () => { try { boot.value = await api('bootstrap'); filters.value = hydrateFilterQuery(route.query as Record<string, unknown>, filters.value); await load(); await nextTick(); const saved = Number(sessionStorage.getItem('ti:inventory-results-scroll') || 0); if (saved) resultsPane.value?.scrollTo({ top: saved }); observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && rows.value.length < total.value && !loadingMore.value && !loading.value) void load(true) }, { root: resultsPane.value, rootMargin: '240px' }); if (sentinel.value) observer.observe(sentinel.value) } catch (cause: any) { error.value = cause.message } })
onBeforeUnmount(() => { if (timer) clearTimeout(timer); sessionStorage.setItem('ti:inventory-results-scroll', String(resultsPane.value?.scrollTop || 0)); controller?.abort(); observer?.disconnect() })
</script>
<template>
  <section class="inventory-destination wide-shell">
    <nav class="inventory-modes" aria-label="库存视图"><button v-for="item in modes" :key="item.key" type="button"
        :class="{ active: mode === item.key }" @click="setMode(item.key)">{{ item.label }}</button></nav>
    <div class="list-layout desktop-list-layout">
      <aside class="filter-sidebar" :class="{ open: filterOpen }">
        <header>
          <h2>筛选</h2><button class="inline-link" type="button" @click="clearFilters">清除全部</button>
        </header>
        <WarehouseSelector v-model="filters.warehouses" :rows="warehouseRows" :counts="facetCounts.warehouses" />
        <HierarchyAutocomplete v-model="filters.item_groups" title="物品类别" placeholder="搜索或浏览物品类别"
          :options="categoryOptions"
          :tree="(boot?.item_groups || []).filter((row: any) => row.name !== 'All Item Groups')" /><button
          class="primary mobile-filter-done" type="button" @click="filterOpen = false">完成</button>
      </aside>
      <div ref="resultsPane" class="results-column">
        <div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索物品或条码"
            aria-label="搜索物品或条码"><button type="button" aria-label="扫描条码" @click="scanner = true">扫描</button><button
            class="mobile-filter-button" type="button" @click="filterOpen = true">筛选</button><button type="button"
            @click="toggleSelection">{{ selection ? '完成选择' : '选择' }}</button><span aria-live="polite">已加载 {{ rows.length
            }} · 筛选结果 {{ total }} · 全部 {{ overall ?? total }}</span></div>
        <ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters" />
        <p v-if="error" class="error">{{ error }} <button type="button" @click="load()">重试</button></p>
        <LoadingIndicator v-if="loading" text="正在加载库存…" />
        <div v-else class="inventory-results">
          <div class="inventory-table-wrap">
            <table class="inventory-table">
              <thead>
                <tr>
                  <th>物品</th>
                  <th>类别</th>
                  <th>可用</th>
                  <th>总计</th>
                  <th>借出</th>
                  <th>损坏</th>
                  <th v-if="selection">选择</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in rows" :key="item.item_code">
                  <td class="item-identity">
                    <ItemImagePreview :src="item.image" :alt="item.item_name" />
                    <RouterLink :to="`/item/${encodeURIComponent(item.item_code)}`"><b>{{ item.item_name }}</b><small>{{
                        item.item_code }}</small></RouterLink>
                  </td>
                  <td>{{ item.item_group }}</td>
                  <td class="quantity available-quantity"><b>{{ item.available_stock }} {{ item.stock_uom }}</b></td>
                  <td class="quantity">{{ item.total_stock }} {{ item.stock_uom }}</td>
                  <td class="quantity">{{ item.on_loan_qty }} {{ item.stock_uom }}</td>
                  <td class="quantity">{{ item.damaged_qty }} {{ item.stock_uom }}</td>
                  <td v-if="selection"><input type="checkbox" :checked="selected.includes(item.item_code)"
                      :aria-label="`选择 ${item.item_name}`" @change="toggle(item.item_code)"></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mobile-cards">
            <article v-for="item in rows" :key="item.item_code" class="item-card">
              <ItemImagePreview :src="item.image" :alt="item.item_name" />
              <RouterLink :to="`/item/${encodeURIComponent(item.item_code)}`"><b>{{ item.item_name }}</b><small>{{
                  item.item_code }} · {{ item.item_group }}</small><strong class="available-quantity">可用 {{
                    item.available_stock }} {{ item.stock_uom }}</strong><small>总计 {{ item.total_stock }} {{
                  item.stock_uom }}</small></RouterLink><input v-if="selection" type="checkbox"
                :checked="selected.includes(item.item_code)" :aria-label="`选择 ${item.item_name}`"
                @change="toggle(item.item_code)">
            </article>
          </div>
          <p v-if="!rows.length" class="empty-state">暂无符合条件的物品</p>
        </div>
        <div ref="sentinel" aria-hidden="true"></div><button v-if="rows.length < total" type="button"
          :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '正在加载…' : '加载更多' }}</button>
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
    <Scanner v-if="scanner" @scan="scan" @close="scanner = false" />
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
