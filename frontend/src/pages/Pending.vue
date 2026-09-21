<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import { hydrateFilterQuery, serializeFilterQuery } from '../composables/filters'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import HierarchyAutocomplete from '../components/HierarchyAutocomplete.vue'
import WarehouseSelector from '../components/WarehouseSelector.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'

const route = useRoute(), router = useRouter()
const boot = ref<any>(), rows = ref<any[]>([]), total = ref(0), overall = ref(0), facets = ref<any>({ warehouses: {}, item_groups: {} })
const error = ref(''), loading = ref(false), loadingMore = ref(false), mode = ref<'all' | 'damaged' | 'unlocated'>(route.query.mode === 'unlocated' ? 'unlocated' : route.query.mode === 'all' ? 'all' : 'damaged')
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const filters = ref({ search: '', warehouses: [] as string[], item_groups: [] as string[] })
const warehouseRows = computed(() => boot.value?.physical_tree || [])
const warehouseText = (name: string) => warehousePresentation(name, warehouseRows.value).breadcrumb
const categoryOptions = computed(() => (boot.value?.item_groups || []).filter((row: any) => row.parent_item_group).map((row: any) => ({ ...row, label: row.item_group_name, count: facets.value.item_groups[row.name], parent: row.parent_item_group })))
const chips = computed(() => [
  ...filters.value.warehouses.map(value => ({ key: 'warehouses', value, label: warehouseText(value) })),
  ...filters.value.item_groups.map(value => ({ key: 'item_groups', value, label: categoryOptions.value.find((row: any) => row.name === value)?.label || value })),
  ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : []),
])
let timer: ReturnType<typeof setTimeout> | undefined
async function load(append = false) {
  append ? loadingMore.value = true : loading.value = true; error.value = ''
  try {
    const data = await api('pending', { mode: mode.value, ...filters.value, warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined, item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined, start: append ? rows.value.length : 0, page_length: 25 })
    const incoming = data.results || []
    rows.value = append ? [...rows.value, ...incoming.filter((row: any) => !rows.value.some(old => old.item_code === row.item_code))] : incoming
    total.value = Number(data.total || 0); overall.value = Number(data.overall_total || 0); facets.value = data.facets || facets.value
  } catch (cause: any) { error.value = cause.message }
  finally { loading.value = false; loadingMore.value = false }
}
function begin(row: any, kind: string) { sessionStorage.setItem(`ti-seed:${kind}`, JSON.stringify({ items: [row.item_code] })); void router.push(`/new/${kind}`) }
function removeChip(chip: any) { if (chip.key === 'search') filters.value.search = ''; else (filters.value as any)[chip.key] = (filters.value as any)[chip.key].filter((value: string) => value !== chip.value) }
function clearFilters() { filters.value = { search: '', warehouses: [], item_groups: [] } }
watch([mode, filters], () => { if (!boot.value) return; if (timer) clearTimeout(timer); void router.replace({ query: { ...serializeFilterQuery(filters.value), mode: mode.value } }); timer = setTimeout(() => void load(), 280) }, { deep: true })
watch(() => route.query, query => { mode.value = query.mode === 'unlocated' ? 'unlocated' : query.mode === 'all' ? 'all' : 'damaged'; const next = hydrateFilterQuery(query as Record<string, unknown>, filters.value); if (JSON.stringify(next) !== JSON.stringify(filters.value)) filters.value = next }, { deep: true })
onMounted(async () => { try { boot.value = await api('bootstrap'); filters.value = hydrateFilterQuery(route.query as Record<string, unknown>, filters.value); await load() } catch (cause: any) { error.value = cause.message } })
</script>
<template>
  <section class="app-shell wide-shell"><header><RouterLink to="/">‹ 库存</RouterLink><h1>待处理</h1></header>
    <nav class="inventory-modes" aria-label="待处理类型"><button type="button" :class="{ active: mode === 'all' }" @click="mode = 'all'">全部</button><button type="button" :class="{ active: mode === 'damaged' }" @click="mode = 'damaged'">损坏</button><button type="button" :class="{ active: mode === 'unlocated' }" @click="mode = 'unlocated'">未定位</button></nav>
    <div class="list-layout"><aside class="filter-sidebar"><WarehouseSelector v-model="filters.warehouses" :rows="warehouseRows" :counts="facets.warehouses" placeholder="搜索仓库 / 位置"/><HierarchyAutocomplete v-model="filters.item_groups" title="物品类别" placeholder="搜索物品类别" :options="categoryOptions" :tree="boot?.item_groups || []"/><button type="button" class="inline-link" @click="clearFilters">清除筛选</button></aside>
      <div class="results-column"><div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索物品或编号" aria-label="搜索待处理物品"><span aria-live="polite">已加载 {{ rows.length }} · 筛选结果 {{ total }} · 全部 {{ overall }}</span></div><ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearFilters"/><p v-if="error" class="error">{{ error }} <button type="button" @click="load()">重试</button></p><LoadingIndicator v-if="loading && !rows.length" text="正在加载待处理物品…"/><article v-for="row in rows" :key="row.item_code" class="selection-row"><RouterLink :to="`/item/${encodeURIComponent(row.item_code)}`"><b>{{ row.item_name }}</b><small>损坏 {{ row.damaged_qty }} · 未定位 {{ row.pending_qty }} {{ row.stock_uom }}</small></RouterLink><div class="detail-actions"><button v-if="row.pending_qty && operationCaps.Transfer" type="button" @click="begin(row, 'Transfer')">分配到位置</button><button v-if="row.damaged_qty && operationCaps.Repair" type="button" @click="begin(row, 'Repair')">修复归库</button><button v-if="row.damaged_qty && operationCaps.Disposal" type="button" @click="begin(row, 'Disposal')">正式报废</button></div></article><p v-if="!rows.length && !error && !loading" class="empty-state">暂无{{ mode === 'all' ? '待处理' : mode === 'damaged' ? '损坏' : '未定位' }}库存</p><button v-if="rows.length < total" type="button" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '正在加载…' : '加载更多' }}</button></div>
    </div>
  </section>
</template>
