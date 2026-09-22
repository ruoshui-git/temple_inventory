<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'

const props = defineProps<{ tree: any[] }>()
const emit = defineEmits<{ select: [row: any]; close: [] }>()
const drawer = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
const rows = ref<any[]>([])
const total = ref(0)
const busy = ref(false)
const appending = ref(false)
const error = ref('')
const query = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | undefined
let sequence = 0

async function load(append = false) {
  const current = ++sequence
  if (append) appending.value = true
  else busy.value = true
  error.value = ''
  try {
    const data = await api('loan_items', { search: query.value || undefined, start: append ? rows.value.length : 0, page_length: 25 })
    if (current !== sequence) return
    const incoming = data.results || []
    rows.value = append ? [...rows.value, ...incoming.filter((row: any) => !rows.value.some(old => old.loan_item === row.loan_item))] : incoming
    total.value = Number(data.total || 0)
  } catch (cause: any) {
    if (current === sequence) error.value = cause.message
  } finally {
    if (current === sequence) { busy.value = false; appending.value = false }
  }
}
function retryAppend() { void load(true) }
function drawerScroll(event: Event) {
  if (typeof IntersectionObserver !== 'undefined') return
  const target = event.currentTarget as HTMLElement
  if (target.scrollHeight - target.scrollTop - target.clientHeight < 180 && rows.value.length < total.value && !busy.value && !appending.value) void load(true)
}
watch(query, () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 300) })
onMounted(async () => {
  await load()
  await nextTick()
  drawer.value?.addEventListener('scroll', drawerScroll, { passive: true })
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && rows.value.length < total.value && !busy.value && !appending.value) void load(true)
    }, { root: drawer.value, rootMargin: '180px' })
    if (sentinel.value) observer.observe(sentinel.value)
  }
})
onBeforeUnmount(() => { if (timer) clearTimeout(timer); observer?.disconnect(); drawer.value?.removeEventListener('scroll', drawerScroll) })
const label = (name: string) => warehousePresentation(name, props.tree).breadcrumb
</script>

<template><div class="drawer-backdrop"><aside ref="drawer" class="drawer wide" role="dialog" aria-modal="true"><h2>选择未归还借出明细</h2><input v-model="query" placeholder="搜索物品、借用方、活动或借出单"><p v-if="busy" class="mobile-loading" role="status">正在加载…</p><p v-if="error" class="error">{{ error }} <button type="button" @click="rows.length ? retryAppend() : load()">重试</button></p><button v-for="row in rows" :key="row.loan_item" class="selection-row" @click="emit('select', row)"><b>{{ row.item_code }} · {{ row.outstanding }} {{ row.uom }}</b><small>{{ row.loan }} · {{ row.borrower }} · {{ row.activity || '无活动' }}</small><small>原位置：{{ label(row.original_warehouse) }}；正常 {{ row.returned }}，损坏 {{ row.damaged }}，遗失 {{ row.lost }}</small></button><p v-if="!busy && !rows.length" class="empty-state">没有未结借出明细</p><div ref="sentinel" aria-hidden="true"></div><p v-if="appending" class="mobile-loading" role="status">正在加载更多记录…</p><button type="button" @click="emit('close')">取消</button></aside></div></template>
