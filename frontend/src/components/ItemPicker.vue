<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { api, workspaceApi, upload } from '../lib/api'
const props = defineProps<{
  boot: any
  barcode?: string
  stockOnly?: boolean
  warehouse?: string
  postingDate?: string
  postingTime?: string
}>()
const emit = defineEmits<{ select: [item: any]; close: []; 'warehouse-change': [warehouse: string] }>()
const query = ref(props.barcode || ''), category = ref(''), selectedWarehouse = ref(props.warehouse || ''), rows = ref<any[]>([]), total = ref(0), start = ref(0), error = ref(''), busy = ref(false)
const creating = ref(!!props.barcode), unitDialog = ref(false), categoryDialog = ref(false), unitName = ref(''), whole = ref(true), categoryName = ref('')
const item = ref({ item_name: '', item_group: props.boot.item_groups[0]?.name || '', stock_uom: props.boot.uoms[0]?.name || '', barcode: props.barcode || '', description: '', has_batch_no: false, has_expiry_date: false })
const photo = ref<File>(), created = ref(''), recent = ref<any[]>([]), recentLoading = ref(true)
const warehouseRows = computed(() => props.boot.warehouses || props.boot.physical_warehouses || [])
let sequence = 0
async function search(offset = 0) {
  const seq = ++sequence
  try {
    const d = await api('search_items', {
      search: query.value,
      category: category.value,
      start: offset,
      warehouse: selectedWarehouse.value || undefined,
      in_stock_only: props.stockOnly || undefined,
      posting_date: props.postingDate || undefined,
      posting_time: props.postingTime || undefined,
    })
    if (seq !== sequence) return
    rows.value = d.results; total.value = d.total; start.value = offset
  } catch (e: any) { error.value = e.message }
}
async function select(code: string) {
  busy.value = true
  try {
    const d = await workspaceApi('item_detail', { item_code: code })
    const key = `ti-recent:${props.boot.user}`
    const codes = [code, ...JSON.parse(localStorage.getItem(key) || '[]').filter((c: string) => c !== code)].slice(0, 8)
    localStorage.setItem(key, JSON.stringify(codes))
    emit('select', d)
  } catch (e: any) { error.value = e.message } finally { busy.value = false }
}
async function create() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (!created.value) { const d = await api('create_item', { data: item.value }); created.value = d.item_code }
    if (photo.value) { const file = await upload(photo.value, 'Item', created.value); await api('set_item_image', { item_code: created.value, image: file.file_url }); photo.value = undefined }
    await select(created.value)
  } catch (e: any) { error.value = e.message } finally { busy.value = false }
}
async function createUnit() { try { const d = await api('create_uom', { uom_name: unitName.value, must_be_whole_number: whole.value }); if (!props.boot.uoms.some((u: any) => u.name === d.name)) props.boot.uoms.push(d); item.value.stock_uom = d.name; unitDialog.value = false } catch (e: any) { error.value = e.message } }
async function createCategory() { try { const d = await api('create_item_group', { name: categoryName.value }); props.boot.item_groups.push(d); item.value.item_group = d.name; categoryDialog.value = false } catch (e: any) { error.value = e.message } }
watch([query, category, selectedWarehouse], () => search())
onMounted(async () => {
  void search()
  try {
    const codes = JSON.parse(localStorage.getItem(`ti-recent:${props.boot.user}`) || '[]')
    const loaded = await Promise.all(codes.map(async (code: string) => { try { return await workspaceApi('item_detail', { item_code: code }) } catch { return undefined } }))
    recent.value = loaded.filter(Boolean)
  } catch { recent.value = [] } finally { recentLoading.value = false }
})
</script>
<template>
<div class="drawer-backdrop"><aside class="drawer wide" role="dialog" aria-modal="true" aria-label="选择物品"><button class="drawer-close" @click="emit('close')">×</button>
<h2>{{ creating ? '创建新物品' : '添加物品' }}</h2><p v-if="error" class="error">{{ error }}</p>
<template v-if="!creating">
<label>搜索物品<input v-model="query" placeholder="搜索名称、编号、条码"></label>
<label>类别<select v-model="category"><option value="">全部类别</option><option v-for="g in boot.item_groups" :value="g.name">{{g.item_group_name}}</option></select></label>
<label v-if="stockOnly">仓库筛选<select v-model="selectedWarehouse" @change="emit('warehouse-change', selectedWarehouse)"><option value="">所有有库存仓库</option><option v-for="w in warehouseRows" :value="w.name">{{w.warehouse_name}}</option></select></label>
<section v-if="!query && (recentLoading || recent.length)" class="recent-items" aria-label="最近使用"><h3>最近使用</h3><div class="recent-strip"><span v-if="recentLoading" class="recent-placeholder">正在加载最近物品…</span><button v-for="r in recent" :key="r.item_code" class="recent-item" :disabled="busy" @click="select(r.item_code)"><img v-if="r.image" :src="r.image" class="thumb"><span>{{r.item_name}}<small>{{r.item_code}}</small></span></button></div></section>
<h3>搜索结果</h3><button v-for="r in rows" :key="r.item_code" class="selection-row compact-selection" :disabled="busy" @click="select(r.item_code)"><img v-if="r.image" :src="r.image" class="thumb"><span><b>{{r.item_name}}</b><small>{{r.item_code}} · {{r.item_group}}<template v-if="stockOnly"> · 可用 {{r.available_qty}} {{r.stock_uom}}</template></small></span></button>
<p v-if="!rows.length && !recentLoading">没有找到物品</p><div class="toolbar"><button :disabled="start===0" @click="search(start-30)">上一页</button><span>{{total}} 项</span><button :disabled="start+30>=total" @click="search(start+30)">下一页</button></div><button v-if="boot.capabilities.Item" @click="creating=true; item.barcode=barcode || ''">＋创建新物品</button></template>
<form v-else @submit.prevent="create"><fieldset :disabled="busy || !!created"><label>名称 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="item.item_name" required></label><label>类别 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><select v-model="item.item_group" required><option v-for="g in boot.item_groups" :value="g.name">{{g.item_group_name}}</option></select></label><button type="button" v-if="boot.capabilities.Item" @click="categoryDialog=true">新建类别</button><label>默认单位 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><select v-model="item.stock_uom" required><option v-for="u in boot.uoms" :value="u.name">{{u.uom_name}}</option></select></label><button type="button" v-if="boot.capabilities.UOM" @click="unitDialog=true">＋新建单位</button><label>条码<input v-model="item.barcode"></label><label>备注<textarea v-model="item.description"/></label><label><input type="checkbox" v-model="item.has_batch_no" :disabled="!boot.batch.enabled">批次追踪</label><label v-if="item.has_batch_no"><input type="checkbox" v-model="item.has_expiry_date">需要有效期</label><p v-if="!boot.batch.enabled" class="warn">{{boot.batch.error}}</p></fieldset>
<label>图片<input type="file" accept="image/*" @change="photo=($event.target as HTMLInputElement).files?.[0]"></label><button class="primary" :disabled="busy">{{created ? '重试图片上传并使用' : '创建并使用'}}</button><button type="button" @click="creating=false">返回搜索</button></form>
<div v-if="unitDialog || categoryDialog" class="nested-dialog"><form @submit.prevent="unitDialog ? createUnit() : createCategory()"><h3>{{unitDialog?'新建单位':'新建类别'}}</h3><label v-if="unitDialog">单位名称 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="unitName" required placeholder="单位名称"></label><label v-else>类别名称 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="categoryName" required placeholder="类别名称"></label><label v-if="unitDialog"><input type="checkbox" v-model="whole">必须为整数</label><button>创建并选择</button><button type="button" @click="unitDialog=false;categoryDialog=false">取消</button></form></div>
</aside></div>
</template>
