<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, upload, workspaceApi } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import Scanner from '../components/Scanner.vue'
import SignaturePad from '../components/SignaturePad.vue'
import AttachmentList from '../components/AttachmentList.vue'
import { toast } from '../lib/toast'

const route = useRoute(), router = useRouter()
const requestId = crypto.randomUUID().replaceAll('-', '')
const boot = ref<any>(), record = ref<any>(), error = ref(''), loading = ref(true), saving = ref(false), scanner = ref(false), conflict = ref(false)
const warehouse = ref(''), mode = ref('selective'), search = ref(''), results = ref<any[]>([]), postingDate = ref(''), postingTime = ref('')
const rows = ref<any[]>([]), notes = ref(''), batchChoices = ref<any[]>([]), batchItem = ref<any>(), review = ref(false)
const reviewDialog = ref<HTMLElement>(), reviewTrigger = ref<HTMLElement>()
const audit = ref({ handler_name: '', handler_signature: '', no_independent_reviewer: true, reviewer_name: '', reviewer_signature: '' })
const readonly = computed(() => Boolean(record.value?.stock_reconciliation || record.value?.docstatus === 1 || !boot.value?.can_reconcile_stock))
const leaves = computed(() => (boot.value?.physical_tree || []).filter((row: any) => (boot.value?.reconciliation_warehouses || []).includes(row.name)))
const warehouseLabel = (name: string, _tree?: any[]) => warehousePresentation(name, _tree || boot.value?.warehouse_tree || []).breadcrumb
const countedRows = computed(() => rows.value.filter(row => row.count_state === 'counted' || row.count_state === 'not_found' || row.counted_qty !== ''))
const discrepancyRows = computed(() => countedRows.value.filter(row => Number(row.counted_qty) !== Number(row.ledger_qty)))
const uomSummary = computed(() => countedRows.value.reduce((summary: Record<string, { increase: number; decrease: number }>, row) => { const uom = row.uom || ''; summary[uom] ||= { increase: 0, decrease: 0 }; const delta = Number(row.counted_qty) - Number(row.ledger_qty); if (delta > 0) summary[uom].increase += delta; if (delta < 0) summary[uom].decrease += Math.abs(delta); return summary }, {}))

function adopt(data: any) {
  record.value = data
  const payload = data.data || {}
  warehouse.value = payload.warehouse || warehouse.value; mode.value = payload.mode || 'selective'; postingDate.value = payload.posting_date || ''; postingTime.value = payload.posting_time || ''; notes.value = payload.notes || ''
  rows.value = (payload.items || []).map((row: any) => ({ ...row, count_state: row.count_state || (row.counted_qty !== '' && row.counted_qty != null ? 'counted' : '') }))
  audit.value = { handler_name: payload.handler_name || '', handler_signature: payload.handler_signature || '', no_independent_reviewer: payload.no_independent_reviewer !== false, reviewer_name: payload.reviewer_name || '', reviewer_signature: payload.reviewer_signature || '' }
}
async function load() {
  try {
    boot.value = await api('bootstrap')
    if (!boot.value.can_read_reconciliations && route.params.name) throw new Error('您没有查看盘点记录的权限')
    if (route.params.name) {
      try { adopt(await workspaceApi('load_workspace', { name: route.params.name })) }
      catch { adopt(await workspaceApi('open_reconciliation', { name: route.params.name })) }
    } else {
      if (!boot.value.can_reconcile_stock) throw new Error('您没有发起盘点调整的权限')
      warehouse.value = leaves.value[0]?.name || ''; postingDate.value = new Date().toISOString().slice(0, 10); postingTime.value = new Date().toTimeString().slice(0, 8)
    }
  } catch (cause: any) { error.value = cause.message } finally { loading.value = false }
}
async function find() { if (!warehouse.value || !search.value) return; try { const data = await api('inventory', { mode: 'current', search: search.value, warehouses: [warehouse.value], page_length: 20 }); results.value = data.results || [] } catch (cause: any) { error.value = cause.message } }
async function add(item: any, batchNo = '') {
  if (item.has_batch_no && !batchNo) { batchItem.value = item; batchChoices.value = await workspaceApi('reconciliation_batches', { item_code: item.item_code, warehouse: warehouse.value }); return }
  const existing = rows.value.find(row => row.item_code === item.item_code && (row.batch_no || '') === batchNo)
  if (existing) { existing.counted_qty = Number(existing.counted_qty || 0) + 1; existing.count_state = 'counted' }
  else rows.value.push({ item_code: item.item_code, warehouse: warehouse.value, uom: item.stock_uom, ledger_qty: batchChoices.value.find(row => row.batch_no === batchNo)?.qty ?? item.warehouse_stock?.[warehouse.value] ?? 0, counted_qty: '', count_state: '', item_name: item.item_name, image: item.image, batch_no: batchNo })
  batchItem.value = undefined; batchChoices.value = []; results.value = []; search.value = ''; void persist()
}
function markNotFound(row: any) { row.counted_qty = 0; row.count_state = 'not_found'; void persist() }
async function scan(value: string) { search.value = value; await find() }
function payload() { return { ...audit.value, warehouse: warehouse.value, mode: mode.value, posting_date: postingDate.value, posting_time: postingTime.value, notes: notes.value, items: rows.value } }
function resetPostingTime() {
  if (readonly.value) return
  postingDate.value = new Date().toISOString().slice(0, 10)
  postingTime.value = new Date().toTimeString().slice(0, 8)
  void persist()
}
let persistChain: Promise<void> = Promise.resolve()
async function persistNow() {
  if (readonly.value || !warehouse.value) return
  saving.value = true; error.value = ''
  try { const creating = !record.value?.name; const result = creating ? await workspaceApi('create_reconciliation', { request_id: requestId, data: payload() }) : await workspaceApi('save_reconciliation', { name: record.value.name, revision: record.value.revision, data: payload() }); adopt(result); if (creating) await router.replace(`/reconcile/${encodeURIComponent(result.name)}`); window.dispatchEvent(new Event('ti:refresh-shell')) }
  catch (cause: any) { error.value = cause.message } finally { saving.value = false }
}
function persist() { persistChain = persistChain.then(persistNow); return persistChain }
async function confirm() { review.value = false; await persist(); if (error.value || !record.value?.name) return; try { saving.value = true; conflict.value = false; adopt(await workspaceApi('confirm_reconciliation', { name: record.value.name, revision: record.value.revision })); toast('盘点已完成'); window.dispatchEvent(new Event('ti:refresh-shell')) } catch (cause: any) { error.value = cause.message; conflict.value = String(cause.message || '').includes('账面数量') } finally { saving.value = false } }
async function refreshBaseline() { if (!record.value?.name) return; try { saving.value = true; adopt(await workspaceApi('refresh_reconciliation_baseline', { name: record.value.name, revision: record.value.revision })); conflict.value = false; error.value = '' } catch (cause: any) { error.value = cause.message } finally { saving.value = false } }
async function attach(event: Event) { if (!record.value?.name) { await persist(); if (!record.value?.name) return }; for (const file of Array.from((event.target as HTMLInputElement).files || [])) await upload(file, 'Inventory Workspace', record.value.name); adopt(await workspaceApi('load_workspace', { name: record.value.name })) }
async function uploadAttachmentFiles(files: File[]) { if (!record.value?.name) { await persist(); if (!record.value?.name) return }; for (const file of files) await upload(file, 'Inventory Workspace', record.value.name); adopt(await workspaceApi('load_workspace', { name: record.value.name })) }
async function removeFile(name: string) { if (!record.value?.name) return; adopt(await workspaceApi('remove_attachment', { name: record.value.name, file_name: name })) }
async function removeAttachmentFile(file: any) { await removeFile(file.name) }
onMounted(load)
watch(review, async open => {
  if (open) {
    reviewTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    await nextTick(() => reviewDialog.value?.focus())
  }
  else await nextTick(() => reviewTrigger.value?.focus())
})
function trapReview(event: KeyboardEvent) {
  const focusable = reviewDialog.value ? Array.from(reviewDialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')) : []
  if (!focusable.length) return
  const current = focusable.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && current <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus() }
  else if (!event.shiftKey && current === focusable.length - 1) { event.preventDefault(); focusable[0].focus() }
}
</script>

<template>
  <button v-if="!loading && !readonly" type="button" class="reconciliation-reset-time" @click="resetPostingTime">重置为当前盘点时间</button>
  <section v-if="batchItem" class="modal" role="dialog" aria-modal="true"><section><h2>选择批次</h2><button v-for="batch in batchChoices" :key="batch.batch_no" type="button" @click="add(batchItem, batch.batch_no)">{{ batch.batch_no }} · {{ batch.expiry_date || '无效期' }} · 账面 {{ batch.qty }}</button><p v-if="!batchChoices.length" class="empty-state">该库位没有可盘点的正库存批次</p><button type="button" @click="batchItem = undefined; batchChoices = []">取消</button></section></section>
  <section v-if="review" ref="reviewDialog" class="modal" role="dialog" aria-modal="true" aria-labelledby="reconciliation-confirm-title" tabindex="-1" @keydown.esc="review = false" @keydown.tab="trapReview"><section><h2 id="reconciliation-confirm-title">确认提交</h2><p>库位：{{ warehouseLabel(warehouse, boot?.warehouse_tree || []) }}</p><p>已确认 {{ countedRows.length }} 行，其中 {{ discrepancyRows.length }} 行有差异。</p><p v-for="(summary, uom) in uomSummary" :key="uom">{{ uom || '未指定单位' }}：增加 {{ summary.increase }}，减少 {{ summary.decrease }}</p><p v-if="record?.attachments?.length">已附 {{ record.attachments.length }} 个文件。</p><p v-if="conflict" class="error">账面数量已变化，请先更新账面数量。</p><div class="detail-actions"><button type="button" :disabled="saving" @click="review = false">取消</button><button class="primary" type="button" :disabled="saving || conflict" @click="confirm">确认提交</button></div></section></section>
  <section v-if="!loading && !readonly" class="reconciliation-audit"><h2>盘点责任确认</h2><label>经手人<input v-model="audit.handler_name" placeholder="请输入姓名或称谓" @change="persist"></label><SignaturePad label="经手人签名" v-model="audit.handler_signature" @complete="persist"/><label><input v-model="audit.no_independent_reviewer" type="checkbox" @change="persist"> 无独立鉴证人</label><template v-if="!audit.no_independent_reviewer"><label>鉴证人<input v-model="audit.reviewer_name" @change="persist"></label><SignaturePad label="鉴证人签名" v-model="audit.reviewer_signature" @complete="persist"/></template></section>
  <p v-if="conflict" class="error">账面数量发生变化。<button type="button" @click="refreshBaseline">更新账面数量并重新检查</button></p>
  <main class="app-shell wide-shell reconciliation-page"><header><button type="button" @click="router.back()">‹ 返回</button><h1>{{ readonly ? '盘点记录' : '盘点' }}</h1><span role="status">{{ saving ? '正在保存…' : record?.stock_reconciliation ? '已完成' : record?.name ? '已保存' : '尚未保存' }}</span></header>
  <LoadingIndicator v-if="loading" text="正在加载盘点…"/><template v-else><p v-if="error" class="error">{{ error }} <button type="button" @click="load">重试</button></p><template v-if="!error"><section class="reconciliation-scope"><h2>1. 选择盘点范围</h2><label>实体叶子库位<select v-model="warehouse" :disabled="readonly" @change="persist"><option value="" disabled>请选择库位</option><option v-for="node in leaves" :key="node.name" :value="node.name">{{ warehouseLabel(node.name, boot?.warehouse_tree || []) }}</option></select></label><label>盘点方式<select v-model="mode" :disabled="readonly" @change="persist"><option value="selective">抽查盘点</option><option value="whole">整库盘点（需逐项确认）</option></select></label><p class="field-hint">盘点时间：{{ postingDate }} {{ postingTime }}。整库盘点必须逐项选择“已盘点”或“未找到，计为 0”。</p></section><section><h2>2. 录入实点数量</h2><div v-if="!readonly" class="result-toolbar"><input v-model="search" placeholder="搜索物品或条码" @keydown.enter="find"><button type="button" @click="find">搜索</button><button type="button" @click="scanner = true">扫描</button></div><div v-if="results.length" class="selection-row"><button v-for="item in results" :key="item.item_code" type="button" @click="add(item)">{{ item.item_name }} · {{ item.item_code }}</button></div><div class="reconciliation-lines"><article v-for="row in rows" :key="`${row.item_code}:${row.batch_no || ''}`" class="item-card"><div><b>{{ row.item_name || row.item_code }}</b><small>{{ row.item_code }}<template v-if="row.batch_no"> · 批次 {{ row.batch_no }}</template> · {{ row.uom }} · 账面 {{ row.ledger_qty }}</small></div><label>实点数量<input v-model="row.counted_qty" type="number" min="0" step="any" :readonly="readonly" @change="row.count_state = 'counted'; persist()"></label><button v-if="!readonly && mode === 'whole'" type="button" @click="markNotFound(row)">未找到，计为 0</button><strong v-if="row.counted_qty !== ''">差异 {{ Number(row.counted_qty) - Number(row.ledger_qty) }}</strong><small v-if="mode === 'whole'">状态：{{ row.count_state === 'not_found' ? '未找到，计为 0' : row.count_state === 'counted' ? '已盘点' : '待确认' }}</small></article></div><p v-if="!rows.length" class="empty-state">尚未添加盘点物品</p></section><section class="reconciliation-summary"><h2>3. 检查差异</h2><p>已确认 {{ countedRows.length }} 行 · 差异 {{ discrepancyRows.length }} 行</p><p v-for="(summary, uom) in uomSummary" :key="uom">{{ uom || '未指定单位' }}：增加 {{ summary.increase }}，减少 {{ summary.decrease }}</p></section><section class="attachments"><h2>备注</h2><textarea v-model="notes" :readonly="readonly" placeholder="可选的盘点说明" @change="persist"></textarea></section><div v-if="!readonly" class="submit-row"><button type="button" @click="persist">保存盘点</button><button class="primary" type="button" :disabled="saving || !rows.some(row => row.count_state === 'counted' || row.count_state === 'not_found')" @click="review = true">提交</button></div></template></template><Scanner v-if="scanner" @scan="scan" @close="scanner = false"/>
  <AttachmentList v-if="record" class="reconciliation-attachment-list" :attachments="record.attachments" :editable="!readonly" @upload="uploadAttachmentFiles" @remove="removeAttachmentFile" />
  </main>
</template>
