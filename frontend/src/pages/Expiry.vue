<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, warehouseLabel } from '../lib/api'
import { hydrateFilterQuery, sameFilterValue, serializeFilterQuery } from '../composables/filters'
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.vue'
import WarehouseTreeFilter from '../components/WarehouseTreeFilter.vue'
import ActiveFilterChips from '../components/ActiveFilterChips.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'

const route = useRoute()
const router = useRouter()
const boot = ref<any>()
const rows = ref<any[]>([])
const error = ref('')
const busy = ref(false)
const refreshing = ref(false)
const total = ref(0)
const start = ref(0)
const pageLength = 50
const filterOpen = ref(false)
const filterPanel = ref<InstanceType<typeof ResponsiveFilterPanel> | null>(null)
const filters = ref({
  search: '',
  warehouses: [] as string[],
  item_groups: [] as string[],
  expiry_from: '',
  expiry_to: '',
  sort: 'asc',
})

const activeCount = computed(() =>
  filters.value.warehouses.length +
  filters.value.item_groups.length +
  (filters.value.search ? 1 : 0) +
  (filters.value.expiry_from ? 1 : 0) +
  (filters.value.expiry_to ? 1 : 0),
)
const chips = computed(() => [
  ...filters.value.warehouses.map(value => ({
    key: 'warehouses',
    value,
    label: warehouseLabel(value, boot.value?.warehouse_tree || []),
  })),
  ...filters.value.item_groups.map(value => ({
    key: 'item_groups',
    value,
    label: boot.value?.item_groups?.find((group: any) => group.name === value)?.item_group_name || value,
  })),
  ...(filters.value.search ? [{ key: 'search', label: `搜索：${filters.value.search}` }] : []),
  ...(filters.value.expiry_from ? [{ key: 'expiry_from', label: `起始：${filters.value.expiry_from}` }] : []),
  ...(filters.value.expiry_to ? [{ key: 'expiry_to', label: `截止：${filters.value.expiry_to}` }] : []),
])

function removeChip(chip: any) {
  if (chip.key === 'warehouses') filters.value.warehouses = filters.value.warehouses.filter(value => value !== chip.value)
  else if (chip.key === 'item_groups') filters.value.item_groups = filters.value.item_groups.filter(value => value !== chip.value)
  else (filters.value as any)[chip.key] = ''
}
function clearAll() {
  filters.value = { search: '', warehouses: [], item_groups: [], expiry_from: '', expiry_to: '', sort: 'asc' }
  start.value = 0
}

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let sequence = 0
let syncingRoute = false
let restoringRoute = false
async function load() {
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
        warehouses: filters.value.warehouses.length ? filters.value.warehouses : undefined,
        item_groups: filters.value.item_groups.length ? filters.value.item_groups : undefined,
        start: start.value,
        page_length: pageLength,
      }, controller?.signal)
      if (current !== sequence) return
      rows.value = data.results || []
      total.value = data.total || 0
      syncingRoute = true
      void router.replace({
        query: { ...route.query, ...serializeFilterQuery({ ...filters.value, start: start.value || undefined }) },
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

function days(value: number) {
  return value < 0 ? `${value} 天` : value === 0 ? '今天到期' : `还有 ${value} 天`
}
function next(delta: number) {
  start.value = Math.max(0, start.value + delta * pageLength)
  void load()
}

watch(filters, () => {
  const preserveStart = restoringRoute
  restoringRoute = false
  if (!preserveStart) start.value = 0
  void load()
}, { deep: true })

watch(() => route.query, query => {
  if (syncingRoute || !boot.value) return
  const hydrated = hydrateFilterQuery(query as Record<string, unknown>, { search: '', warehouses: [] as string[], item_groups: [] as string[], expiry_from: '', expiry_to: '', sort: 'asc', start: '0' })
  const next = { search: String(hydrated.search || ''), warehouses: hydrated.warehouses as string[], item_groups: hydrated.item_groups as string[], expiry_from: String(hydrated.expiry_from || ''), expiry_to: String(hydrated.expiry_to || ''), sort: String(hydrated.sort || 'asc') }
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
      expiry_from: '',
      expiry_to: '',
      sort: 'asc',
      start: '0',
    })
    filters.value = {
      search: String(hydrated.search || ''),
      warehouses: hydrated.warehouses as string[],
      item_groups: hydrated.item_groups as string[],
      expiry_from: String(hydrated.expiry_from || ''),
      expiry_to: String(hydrated.expiry_to || ''),
      sort: String(hydrated.sort || 'asc'),
    }
    start.value = Number(hydrated.start) || 0
    await load()
  } catch (cause: any) {
    error.value = cause.message
  }
})
</script>

<template>
  <main class="app-shell wide-shell">
    <header><RouterLink to="/">‹ 首页</RouterLink><h1>有效期</h1></header>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="list-layout">
      <ResponsiveFilterPanel ref="filterPanel" v-model:open="filterOpen" :count="activeCount">
        <WarehouseTreeFilter v-model="filters.warehouses" :options="boot?.physical_tree || []" :tree="boot?.warehouse_tree || []" />
        <fieldset class="category-filter"><legend>物品类别</legend><label v-for="group in boot?.item_groups || []" :key="group.name"><input v-model="filters.item_groups" type="checkbox" :value="group.name">{{ group.item_group_name }}</label></fieldset>
        <fieldset><legend>到期日期</legend><label>到期从<input v-model="filters.expiry_from" type="date"></label><label>到期至<input v-model="filters.expiry_to" type="date"></label></fieldset>
        <fieldset><legend>排序</legend><label><input v-model="filters.sort" type="radio" value="asc">最近到期优先</label><label><input v-model="filters.sort" type="radio" value="desc">最晚到期优先</label></fieldset>
      </ResponsiveFilterPanel>
      <div class="results-column">
        <div class="result-toolbar"><input v-model="filters.search" type="search" placeholder="搜索物品或批次" aria-label="搜索物品或批次"><button class="mobile-filter-button" type="button" @click="filterPanel?.openPanel($event)">筛选<span v-if="activeCount">（{{ activeCount }}）</span></button><span aria-live="polite">{{ refreshing ? '正在更新…' : `${total} 条结果` }}</span></div>
        <ActiveFilterChips :chips="chips" @remove="removeChip" @clear="clearAll" />
        <LoadingIndicator v-if="busy && !rows.length" text="正在加载有效期…" />
        <template v-else>
          <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th scope="col">物品 / 批次</th><th scope="col">类别</th><th scope="col">到期日期</th><th scope="col">剩余</th><th scope="col">数量</th><th scope="col">位置</th></tr></thead><tbody><tr v-for="row in rows" :key="row.batch_no"><td><b>{{ row.item_name }}</b><small>{{ row.item_code }} · {{ row.batch_no }}</small></td><td>{{ row.item_group }}</td><td>{{ row.expiry_date }}</td><td :class="{ warn: row.days_to_expiry < 0 }">{{ days(row.days_to_expiry) }}</td><td class="quantity">{{ row.total_qty }} {{ row.stock_uom }}</td><td><span v-for="location in row.locations" :key="location.warehouse" class="location-line">{{ warehouseLabel(location.warehouse, boot?.warehouse_tree || []) }}：{{ location.qty }}</span></td></tr></tbody></table></div>
          <div class="mobile-cards"><article v-for="row in rows" :key="row.batch_no" class="item-card"><div><b>{{ row.item_code }} · {{ row.item_name }}</b><p>{{ row.item_group }} · 批次 {{ row.batch_no }} · {{ row.total_qty }} {{ row.stock_uom }}</p><p>到期 {{ row.expiry_date }} · <span :class="{ warn: row.days_to_expiry < 0 }">{{ days(row.days_to_expiry) }}</span></p></div></article></div>
          <p v-if="!rows.length" class="empty-state">暂无有库存的有效期批次</p>
        </template>
        <nav v-if="total > pageLength" class="pagination" aria-label="有效期分页"><button :disabled="start === 0 || busy" @click="next(-1)">上一页</button><span>{{ start + 1 }}–{{ Math.min(start + pageLength, total) }} / {{ total }}</span><button :disabled="start + pageLength >= total || busy" @click="next(1)">下一页</button></nav>
      </div>
    </div>
  </main>
</template>
