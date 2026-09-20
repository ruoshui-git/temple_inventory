<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api, workspaceApi, upload, labels, warehouseLabel, roomFor, sessionExpired } from '../lib/api'
import { SaveQueue } from '../lib/autosave'
import Scanner from '../components/Scanner.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import ItemPicker from '../components/ItemPicker.vue'
import LoanItemPicker from '../components/LoanItemPicker.vue'
import SignaturePad from '../components/SignaturePad.vue'
import { toast } from '../lib/toast'

const route = useRoute(), router = useRouter()
const boot = ref<any>(), record = ref<any>(), form = ref<any>(), error = ref(''), saveStatus = ref('正在加载…')
const dirty = ref(false), conflict = ref(false), saving = ref(false), confirming = ref(false)
const picker = ref(false), loanPicker = ref(false), scanner = ref(false), unknown = ref(''), scanBusy = ref(false), recentScans = ref<string[]>([])
const catalog = ref<Record<string, any>>({}), activities = ref<any[]>([])
const seedQueue = ref<any[]>([])
const review = ref(false), activityDialog = ref(false), activitySearch = ref(''), detailsOpen = ref(false)
const currentRoom = ref(''), currentLocation = ref(''), currentTo = ref(''), lastScannedWarehouse = ref(''), scopeGroup = ref('')
const chosen = ref<any>(), line = ref<any>(), editingIndex = ref(-1), batchRows = ref<any[]>([])
const activity = ref({ title: '', activity_type: 'Other', start_date: '', end_date: '', description: '' })
const activityTypeLabel = (t: string) => ({ Distribution: '分发', Event: '活动', Performance: '演出', 'Religious Activity': '宗教活动', Maintenance: '维护', Other: '其他' } as any)[t] || t
const newRequestId = ref('')
let applying = false, editVersion = 0

const readonly = computed(() => !!record.value?.docstatus)
const tree = computed<any[]>(() => boot.value?.warehouse_tree || [])
const allowed = computed<any[]>(() => boot.value?.warehouses || boot.value?.physical_warehouses || [])
const inScope = (name: string) => {
  if (!scopeGroup.value) return true
  const group = tree.value.find((node: any) => node.name === scopeGroup.value)
  const node = tree.value.find((item: any) => item.name === name)
  return Boolean(group && node && Number(node.lft) >= Number(group.lft) && Number(node.rgt) <= Number(group.rgt))
}
const scopedAllowed = computed(() => allowed.value.filter(w => inScope(w.name)))
const rooms = computed(() => {
  const names = new Set(scopedAllowed.value.map(w => roomFor(w.name, tree.value)))
  return [...names].map(name => tree.value.find(w => w.name === name)).filter(Boolean)
})
const locations = computed(() => scopedAllowed.value.filter(w => !currentRoom.value || roomFor(w.name, tree.value) === currentRoom.value))
const isReceive = computed(() => form.value?.movement_kind === 'Receive')
const isIssue = computed(() => ['Issue', 'Loss', 'Disposal'].includes(form.value?.movement_kind))
const isTransfer = computed(() => ['Transfer', 'Loan', 'Return', 'Damage', 'Repair'].includes(form.value?.movement_kind))
const postingTimeMode = computed(() => form.value?.posting_time_mode || 'current')
const groups = computed(() => {
  const result: Record<string, { room: string; location: string; lines: any[]; first: number }> = {}
  for (const section of form.value?.sections || []) result[section.warehouse] ||= { room: roomFor(section.warehouse, tree.value), location: section.warehouse, lines: [], first: Number.MAX_SAFE_INTEGER }
  for (const [index, row] of (form.value?.items || []).entries()) {
    const location = isReceive.value ? row.warehouse : (row.from_warehouse || row.warehouse)
    if (!location) continue
    result[location] ||= { room: roomFor(location, tree.value), location, lines: [], first: index }
    result[location].lines.push({ ...row, index })
    result[location].first = Math.min(result[location].first, index)
  }
  return Object.values(result).sort((a, b) => a.first - b.first)
})
const totals = computed(() => {
  const result: Record<string, number> = {}
  for (const row of form.value?.items || []) result[row.uom] = (result[row.uom] || 0) + Number(row.qty || 0)
  return result
})
const sourceOptions = computed(() => {
  const names = new Set(allowed.value.map(w => w.name))
  return (chosen.value?.stock || []).filter((row: any) => names.has(row.warehouse) && Number(row.actual_qty) > 0)
})
const label = (name: string) => warehouseLabel(name, tree.value)
const leafLabel = (name: string) => tree.value.find(w => w.name === name)?.warehouse_name || label(name)
const requiredMark = '<span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span>'

function changed(immediate = false) {
  if (applying || readonly.value) return
  editVersion++; dirty.value = true; saveStatus.value = '尚未保存'; queue.schedule(immediate)
}
function invalidate() { if (form.value) { form.value.handler_signature = ''; form.value.reviewer_signature = '' } }
function setNoIndependentReviewer(value: boolean) { if (!form.value) return; form.value.no_independent_reviewer = value; if (value) { form.value.reviewer_name = ''; form.value.reviewer_signature = '' }; invalidate(); changed(true) }
function setBorrowerDeclaration(value: boolean) { if (!form.value) return; form.value.borrower_is_handler_or_witness = value; if (value) form.value.borrower = ''; invalidate(); changed(true) }
function markManualTime() { if (form.value && form.value.posting_time_mode !== 'manual') form.value.posting_time_mode = 'manual'; invalidate() }
function setCurrentTime() {
  if (!form.value) return
  const now = new Date(), pad = (n: number) => String(n).padStart(2, '0')
  form.value.posting_date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  form.value.posting_time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  form.value.posting_time_mode = 'current'; invalidate(); changed(true)
}
watch(form, () => changed(), { deep: true, flush: 'sync' })

async function adoptWorkspaceRoute(name: string, movementKind: string) {
  try {
    const failure = await router.replace(`/workspace/${name}`)
    if (!failure) sessionStorage.removeItem(`ti-new:${movementKind}`)
    else if (!dirty.value) error.value = '已保存，但无法打开记录页面，请刷新重试'
  } catch (e: any) { error.value = e?.message || '已保存，但无法打开记录页面，请刷新重试' }
}

const queue = new SaveQueue(async () => {
  if (!record.value || readonly.value) return
  saving.value = true; saveStatus.value = record.value.name ? '正在保存…' : '正在创建草稿…'
  const version = editVersion, creating = !record.value.name
  try {
    const payload = JSON.parse(JSON.stringify(form.value))
    const result = record.value.name
      ? await workspaceApi('save_workspace', { name: record.value.name, revision: record.value.revision, data: payload })
      : await workspaceApi('create_workspace', { request_id: newRequestId.value, movement_kind: payload.movement_kind, data: payload })
    record.value = result
    if (version === editVersion) { applying = true; form.value = result.data; applying = false; dirty.value = false; saveStatus.value = '✓ 已保存' }
    else saveStatus.value = '尚未保存'
    if (creating && route.path.startsWith('/new/')) void adoptWorkspaceRoute(result.name, payload.movement_kind)
  } finally { saving.value = false }
}, (e) => {
  error.value = e.message; saveStatus.value = '⚠ 尚未保存'
  if (e.kind === 'TimestampMismatchError') conflict.value = true
}, () => sessionExpired.value || conflict.value)

async function hydrate() {
  for (const row of form.value.items || []) if (!catalog.value[row.item_code]) {
    try { catalog.value[row.item_code] = await workspaceApi('item_detail', { item_code: row.item_code }) }
    catch (e: any) { error.value = e.message }
  }
}
async function load() {
  try {
    boot.value = await api('bootstrap')
    activities.value = await workspaceApi('activities')
    let d: any
    if (route.params.name) d = await workspaceApi('load_workspace', { name: route.params.name })
    else if (route.params.entry) d = await workspaceApi('open_entry', { name: route.params.entry })
    else {
      const kind = String(route.params.kind || 'Receive'), key = sessionStorage.getItem(`ti-new:${kind}`) || crypto.randomUUID()
      const scopeKey = `ti-scope:${kind}`
      const scope = sessionStorage.getItem(scopeKey)
      if (scope) {
        try { scopeGroup.value = JSON.parse(scope).group || '' } catch { scopeGroup.value = '' }
        sessionStorage.removeItem(scopeKey)
      }
      sessionStorage.setItem(`ti-new:${kind}`, key); newRequestId.value = key
      const now = new Date(), pad = (n: number) => String(n).padStart(2, '0')
      d = { name: '', revision: 0, stock_entry: null, docstatus: 0, sync_error: '', attachments: [], data: {
        movement_kind: kind, posting_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, posting_time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, posting_time_mode: 'current', handler_name: '', handler_signature: '', borrower_is_handler_or_witness: kind === 'Loan',
        activity: '', notes: '', source_text: '', purpose_text: '', borrower: '', recorded_by: boot.value.user, reviewer_name: '', no_independent_reviewer: false, reviewer_signature: '', loan_record: '', return_record: '', loss_record: '', items: [], sections: [], from_warehouse: '', to_warehouse: ''
      }}
      if (kind === 'Loss' && route.query.loan_item) {
        const candidates = await api('outstanding_loan_items')
        const row = candidates.find((candidate:any) => candidate.loan_item === route.query.loan_item)
        if (row) d.data.items = [{ id: crypto.randomUUID(), item_code: row.item_code, qty: row.outstanding, uom: row.uom, batch_no: row.batch_no || '', original_loan_item: row.loan_item, loan_item: row.loan_item, warehouse: boot.value.settings.loan_warehouse, from_warehouse: boot.value.settings.loan_warehouse }]
      }
    }
    record.value = d; applying = true; form.value = d.data; applying = false; dirty.value = false; conflict.value = false; saveStatus.value = d.name ? '✓ 已保存' : '正在创建草稿…'
    const physical = scopedAllowed.value.length ? scopedAllowed.value : allowed.value
    const requestedLocation = String(route.query.warehouse || '')
    currentLocation.value = physical.some((row: any) => row.name === requestedLocation) ? requestedLocation : physical[0]?.name || ''
    if (isIssue.value && currentLocation.value) lastScannedWarehouse.value = currentLocation.value
    currentRoom.value = roomFor(currentLocation.value, tree.value); currentTo.value = boot.value.settings.loan_warehouse || boot.value.settings.leased_warehouse || boot.value.settings.default_lease_program_warehouse || ''
    if (!d.name) {
		const unknownBarcode = sessionStorage.getItem("ti-unknown-barcode") || ""
		if (unknownBarcode && d.data.movement_kind === "Receive") {
			unknown.value = unknownBarcode
			sessionStorage.removeItem("ti-unknown-barcode")
			picker.value = true
		}
      const seed = sessionStorage.getItem(`ti-seed:${d.data.movement_kind}`)
      if (seed) {
        try {
          const parsed = JSON.parse(seed)
          seedQueue.value = await Promise.all((parsed.items || []).map(async (entry: any) => {
            const itemCode = typeof entry === 'string' ? entry : entry.item_code
            const detail = await workspaceApi('item_detail', { item_code: itemCode })
            catalog.value[itemCode] = detail
            return { ...entry, item_code: itemCode, detail }
          }))
        } catch (cause: any) { error.value = cause.message || '无法恢复预选物品' }
      }
    }
    await hydrate()
    // Opening a flow is not a business edit.  The first meaningful change
    // enters the existing serialized queue and creates the workspace then.
    saveStatus.value = d.name ? '✓ 已保存' : '尚未保存'
  } catch (e: any) { error.value = e.message; saveStatus.value = '加载失败' }
}
function selectLoanItem(row:any) {
  loanPicker.value=false
  chosen.value = undefined; line.value = {id:crypto.randomUUID(), item_code:row.item_code, qty:row.outstanding, uom:row.uom, batch_no:row.batch_no || '', loan_item:row.loan_item, original_loan_item:row.loan_item, from_warehouse:boot.value.settings.loan_warehouse, to_warehouse:row.original_warehouse, outcome:'Returned', warehouse:boot.value.settings.loan_warehouse}
  form.value.borrower = row.borrower; form.value.activity = row.activity || ''; changed(true)
}
async function configureSeed(seed: any) {
  if (seed.loan_item) selectLoanItem(seed)
  else await selectItem(seed.detail || catalog.value[seed.item_code])
  seedQueue.value = seedQueue.value.filter(item => item !== seed)
}
async function selectItem(item: any) {
  if (isIssue.value) {
    const stock = (item.stock || []).filter((row: any) => allowed.value.some(w => w.name === row.warehouse) && Number(row.actual_qty) > 0)
    const preferred = lastScannedWarehouse.value && stock.find((row: any) => row.warehouse === lastScannedWarehouse.value)
    if (lastScannedWarehouse.value && !preferred) { error.value = `该物品在${label(lastScannedWarehouse.value)}没有库存`; return }
    if (!stock.length) { error.value = '该物品没有可用库存'; return }
    item = { ...item, stock }; catalog.value[item.item_code] = item; chosen.value = item; picker.value = false; unknown.value = ''; editingIndex.value = -1
    const warehouse = preferred?.warehouse || (stock.length === 1 ? stock[0].warehouse : '')
    line.value = { id: crypto.randomUUID(), item_code: item.item_code, qty: null, uom: item.stock_uom, warehouse, from_warehouse: warehouse, to_warehouse: currentTo.value, batch_no: '', new_batch: false }
  } else {
    catalog.value[item.item_code] = item; chosen.value = item; picker.value = false; unknown.value = ''; editingIndex.value = -1
    line.value = { id: crypto.randomUUID(), item_code: item.item_code, qty: null, uom: item.stock_uom, warehouse: currentLocation.value, from_warehouse: currentLocation.value, to_warehouse: form.value.movement_kind === 'Loan' ? (boot.value.settings.loan_warehouse || boot.value.settings.leased_warehouse || boot.value.settings.default_lease_program_warehouse) : form.value.movement_kind === 'Damage' ? boot.value.settings.damaged_warehouse : currentTo.value, batch_no: '', new_batch: false }
  }
  await loadBatches()
}
async function editLine(index: number) { editingIndex.value = index; line.value = JSON.parse(JSON.stringify(form.value.items[index])); chosen.value = catalog.value[line.value.item_code] || await workspaceApi('item_detail', { item_code: line.value.item_code }); await loadBatches() }
async function loadBatches() { if (!chosen.value?.has_batch_no || !line.value) return; try { batchRows.value = await workspaceApi('batches', { item_code: chosen.value.item_code, warehouse: isReceive.value ? undefined : line.value.from_warehouse || line.value.warehouse }) } catch (e: any) { error.value = e.message } }
async function scan(value: string) {
  if (scanBusy.value || chosen.value) return
  scanBusy.value = true
  try {
    const d = await api('scan', { value })
    if (d.unknown) { unknown.value = value; picker.value = true }
    else if (d.item_code) {
      const detail = await workspaceApi('item_detail', { item_code: d.item_code })
      if (isIssue.value && lastScannedWarehouse.value && !(detail.stock || []).some((row: any) => row.warehouse === lastScannedWarehouse.value && Number(row.actual_qty) > 0)) { error.value = `该物品在${label(lastScannedWarehouse.value)}没有库存`; return }
      await selectItem(detail); if (d.batch_no) line.value.batch_no = d.batch_no
    } else if (d.warehouse) {
      if (isIssue.value && !allowed.value.some(w => w.name === d.warehouse)) { error.value = '该仓库不能用于出库'; return }
      lastScannedWarehouse.value = d.warehouse; currentLocation.value = d.warehouse; currentRoom.value = roomFor(d.warehouse, tree.value)
    }
  } catch (e: any) { error.value = e.message } finally { scanBusy.value = false }
}
function addLine() {
  if (!line.value || !(Number(line.value.qty) > 0)) return
  if (isIssue.value) {
    const source = sourceOptions.value.find((row: any) => row.warehouse === line.value.from_warehouse)
    if (!source) { error.value = '请选择有库存的来源仓库'; return }
    const conversion = line.value.uom === chosen.value.stock_uom ? 1 : Number(chosen.value.uoms.find((u: any) => u.uom === line.value.uom)?.conversion_factor || 0)
    const existing = (form.value.items || []).filter((row: any) => row.item_code === line.value.item_code && (row.from_warehouse || row.warehouse) === line.value.from_warehouse).reduce((sum: number, row: any) => sum + Number(row.qty || 0) * (row.uom === chosen.value.stock_uom ? 1 : Number(chosen.value.uoms.find((u: any) => u.uom === row.uom)?.conversion_factor || 0)), 0)
    if (!conversion || (existing + Number(line.value.qty) * conversion) > Number(source.actual_qty) + 1e-8) { error.value = `数量超过${label(source.warehouse)}的可用库存`; return }
  }
  invalidate(); const row = { ...line.value }; if (!isReceive.value) row.warehouse = row.from_warehouse
  if (editingIndex.value >= 0) form.value.items.splice(editingIndex.value, 1, row); else form.value.items.unshift(row)
  currentLocation.value = isReceive.value ? row.warehouse : row.from_warehouse; currentRoom.value = roomFor(currentLocation.value, tree.value); currentTo.value = row.to_warehouse
  recentScans.value.unshift(`${chosen.value.item_name} · ${row.qty} ${row.uom}`); chosen.value = undefined; line.value = undefined; editingIndex.value = -1; error.value = ''; changed(true)
}
function removeLine(index: number) { invalidate(); form.value.items.splice(index, 1); changed(true) }
async function attach(event: Event) { const input = event.target as HTMLInputElement; error.value = ''; try { if (!record.value.name) { dirty.value = true; queue.schedule(true) }; await queue.flush(); if (dirty.value || !record.value.name) return; for (const file of Array.from(input.files || [])) await upload(file, 'Inventory Workspace', record.value.name); record.value = await workspaceApi('load_workspace', { name: record.value.name }) } catch (e: any) { error.value = e.message } finally { input.value = '' } }
async function removeFile(name: string) { try { record.value = await workspaceApi('remove_attachment', { name: record.value.name, file_name: name }) } catch (e: any) { error.value = e.message } }
async function createActivity() { try { const d = await workspaceApi('create_activity', { data: activity.value }); activities.value.unshift(d); invalidate(); form.value.activity = d.name; activityDialog.value = false; changed(true) } catch (e: any) { error.value = e.message } }
async function showReview() {
  error.value = ''; await queue.flush()
  if (dirty.value || conflict.value) { error.value = conflict.value ? '记录有冲突，请重新加载' : '请先保存所有修改'; return }
  if (!form.value.items?.length) { error.value = '请至少添加一个物品'; return }
  if (!form.value.handler_name?.trim()) { error.value = '请填写经手人'; return }
  if (!form.value.handler_signature) { error.value = '请完成经手人签名'; return }
  if (form.value.movement_kind === 'Loan' && !form.value.borrower_is_handler_or_witness && !form.value.borrower?.trim()) { error.value = '请填写借用方'; return }
  if (record.value.sync_error) { error.value = record.value.sync_error; return }
  review.value = true
}
async function confirm() {
  if (confirming.value) return
  confirming.value = true; error.value = ''
  try {
    await queue.flush(); if (dirty.value) throw new Error('请先保存所有修改')
    const d = await workspaceApi('confirm_workspace', { name: record.value.name, revision: record.value.revision })
    record.value = d; applying = true; form.value = d.data; applying = false; review.value = false; scanner.value = false; saveStatus.value = '已完成 ✓'; window.dispatchEvent(new Event('ti:refresh-shell'))
    if (form.value.movement_kind === 'Return') {
      const outstanding = await api('outstanding_loan_items')
      const candidate = outstanding.find((row:any) => row.loan_item)
      if (candidate && window.confirm('该借出明细仍有未结数量。是否继续记录遗失？')) await router.push(`/new/Loss?loan_item=${encodeURIComponent(candidate.loan_item)}`)
    }
  } catch (e: any) { error.value = e.message; toast(e.message, 'error') } finally { confirming.value = false }
}
function beforeUnload(e: BeforeUnloadEvent) { if (dirty.value) { e.preventDefault(); e.returnValue = '' } }
watch(sessionExpired, v => { if (v) scanner.value = false; else if (dirty.value) queue.schedule(true) })
async function deleteDraft() { if (!record.value?.name || !window.confirm('确定删除这条未完成记录吗？此操作无法撤销。')) return; try { await queue.flush(); await workspaceApi('delete_draft', { name: record.value.name }); window.dispatchEvent(new Event('ti:refresh-shell')); await router.replace('/history?status=unfinished') } catch (e: any) { error.value = e.message } }
onBeforeRouteLeave(async () => { await queue.flush(); if (dirty.value) return window.confirm('还有尚未保存的修改。确定离开？') })
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => { queue.dispose(); window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
<main class="app-shell workspace"><header><RouterLink to="/">‹ 首页</RouterLink><h1>{{labels[form?.movement_kind]||'库存记录'}}</h1><button v-if="!readonly && record?.name" @click="deleteDraft">删除草稿</button><span role="status">{{readonly ? (record.docstatus===1?'已完成 ✓':'已取消') : saveStatus}}</span></header>
<p v-if="error" class="error" role="alert">{{error}}</p><div v-if="conflict" class="error">记录已在其他窗口修改。当前输入仍保留在页面中，请复制需要保留的内容后重新打开记录。<button @click="load">重新加载</button></div><button v-else-if="dirty && !saving" @click="queue.schedule(true)">重试保存</button>
<LoadingIndicator v-if="!form || !boot" text="正在加载工作区…" /><template v-else>
<fieldset :disabled="readonly || confirming"><div class="form-grid"><label>日期 <span v-html="requiredMark"/><input type="date" v-model="form.posting_date" required @input="markManualTime"></label><label>时间 <span v-html="requiredMark"/><input type="time" step="1" v-model="form.posting_time" required @input="markManualTime"></label><button v-if="postingTimeMode==='manual'" type="button" @click="setCurrentTime">使用当前时间</button><p v-else class="field-hint">提交时使用当前时间</p></div></fieldset>
<div v-if="!isIssue && !readonly" class="location-bar"><label>当前房间<select v-model="currentRoom" @change="currentLocation=locations[0]?.name||''"><option v-for="r in rooms" :value="r.name">{{label(r.name)}}</option></select></label><label v-if="locations.length>1">当前位置<select v-model="currentLocation"><option v-for="w in locations" :value="w.name">{{label(w.name)}}</option></select></label><button v-if="form.items?.length" type="button" @click="currentLocation='';currentRoom=''">新增仓库/位置</button></div>
<div v-if="!readonly" class="toolbar workspace-tools"><button type="button" @click="form.movement_kind==='Return' ? loanPicker=true : picker=true;unknown=''">＋添加物品</button><button v-if="form.movement_kind==='Loss'" type="button" @click="loanPicker=true">从未结借出选择</button><button type="button" @click="scanner=!scanner">▣ 连续扫码</button><span v-if="isIssue && lastScannedWarehouse" class="filter-chip">出库仓库：{{label(lastScannedWarehouse)}} <button type="button" @click="lastScannedWarehouse=''">清除</button></span></div>
<Scanner v-if="scanner && !readonly" :paused="!!chosen||picker||scanBusy" @scan="scan" @close="scanner=false"/><ul v-if="scanner"><li v-for="text in recentScans.slice(0,5)">✓ {{text}}</li></ul>
<section v-if="seedQueue.length && !readonly" class="seed-queue"><h2>待配置物品</h2><p class="field-hint">请为每项确认数量和实际库存位置后再加入记录。</p><button v-for="seed in seedQueue" :key="seed.loan_item || seed.item_code" type="button" class="selection-row" @click="configureSeed(seed)"><img v-if="seed.detail?.image" :src="seed.detail.image" class="thumb"><b>{{seed.detail?.item_name || seed.item_code}}</b><small>{{seed.loan_item ? `未结 ${seed.outstanding} ${seed.uom}` : '选择数量和位置'}}</small></button></section>
<p v-if="record.sync_error && form.items?.length" class="error">{{record.sync_error}}</p><p v-if="!form.items?.length" class="empty-state">尚未添加物品，请点击“添加物品”开始。</p><section v-for="g in groups" :key="g.location" class="location-section"><h2>📍 {{label(g.room)}}</h2><h3 v-if="g.location !== g.room">{{leafLabel(g.location)}}</h3><p v-if="!g.lines.length">尚未添加物品</p><article v-for="r in g.lines" :key="r.id" class="item-card"><img v-if="catalog[r.item_code]?.image" :src="catalog[r.item_code].image"><div><b>{{catalog[r.item_code]?.item_name||r.item_code}}</b><p>{{r.qty}} {{r.uom}} <small>{{r.item_code}}</small></p><p v-if="r.batch_no">批次 {{r.batch_no}}</p><p v-if="r.expiry_date">到期 {{r.expiry_date}}</p><p v-if="isTransfer">→ {{label(r.to_warehouse)}}</p></div><div v-if="!readonly"><button type="button" @click="editLine(r.index)">编辑</button><button type="button" @click="removeLine(r.index)">移除</button></div></article></section>
<section class="details-panel"><button v-if="!readonly" type="button" @click="detailsOpen=!detailsOpen">{{detailsOpen?'收起详细信息':'添加详细信息'}}</button><div v-if="detailsOpen || readonly" class="details-content"><fieldset :disabled="readonly||confirming" @input="invalidate"><div class="form-grid"><label v-if="isReceive">来源<input v-model="form.source_text" placeholder="例如：捐赠、采购或内部调拨"></label><label v-if="!isReceive">用途<input v-model="form.purpose_text" list="purposes"><datalist id="purposes"><option v-for="p in ['分发','活动/演出','内部使用','对外捐赠','损坏/报废','其他']">{{p}}</option></datalist></label><label v-if="['Return','Loss'].includes(form.movement_kind) || (form.movement_kind==='Loan' && !form.borrower_is_handler_or_witness)">借用方<input v-model="form.borrower" :readonly="form.movement_kind==='Return' && !!form.items?.length" placeholder="姓名、单位或团体"></label><label>活动<button type="button" class="selector-button" @click="activityDialog=true">{{activities.find((a:any)=>a.name===form.activity)?.title||'选择活动'}}</button></label><label>备注<textarea v-model="form.notes"/></label></div></fieldset><section class="attachments"><h2>附件 / 照片 · {{record.attachments?.length||0}}</h2><template v-if="!readonly"><label class="file-button">上传文件<input type="file" multiple @change="attach"></label></template><div class="attachment-grid"><article v-for="f in record.attachments" :key="f.name"><a :href="f.file_url" target="_blank" rel="noopener"><img v-if="/\.(png|jpe?g|webp|gif)$/i.test(f.file_name)" :src="f.file_url" class="thumb">{{f.file_name}}</a><button v-if="!readonly" type="button" @click="removeFile(f.name)">移除</button></article></div></section></div></section>
<fieldset :disabled="readonly||confirming"><label v-if="form.movement_kind==='Loan'" class="checkbox"><input type="checkbox" :checked="form.borrower_is_handler_or_witness" @change="setBorrowerDeclaration(($event.target as HTMLInputElement).checked)"> 借用方是经手人或鉴证人</label><label>经手人 <span v-html="requiredMark"/><input v-model="form.handler_name" required placeholder="请输入姓名或称谓" @input="changed(true)"></label><SignaturePad label="经手人签名" v-model="form.handler_signature" :disabled="readonly||confirming" @complete="changed(true)"/><label class="checkbox"><input type="checkbox" :checked="form.no_independent_reviewer" @change="setNoIndependentReviewer(($event.target as HTMLInputElement).checked)" :disabled="readonly||confirming"> 无独立鉴证人</label><template v-if="!form.no_independent_reviewer"><label>鉴证人 <span v-html="requiredMark"/><input v-model="form.reviewer_name" required @input="changed(true)"></label><SignaturePad label="鉴证人签名" v-model="form.reviewer_signature" :disabled="readonly||confirming" @complete="changed(true)"/></template></fieldset><button v-if="!readonly" class="primary confirm-button" :disabled="confirming||conflict" @click="showReview">提交</button><small v-if="!readonly" class="muted">系统记录用户：{{ form.recorded_by || boot.user }}</small><p v-if="record.stock_entry">库存记录：{{record.stock_entry}} <a v-if="boot.is_manager" :href="`/app/stock-entry/${encodeURIComponent(record.stock_entry)}`">管理员查看</a></p>
<LoanItemPicker v-if="loanPicker" :tree="tree" @select="selectLoanItem" @close="loanPicker=false"/><ItemPicker v-if="picker" :boot="boot" :barcode="unknown" :stock-only="isIssue" :warehouse="lastScannedWarehouse" :posting-date="postingTimeMode==='manual' ? form.posting_date : undefined" :posting-time="postingTimeMode==='manual' ? form.posting_time : undefined" @warehouse-change="lastScannedWarehouse=$event" @select="selectItem" @close="picker=false;unknown=''"/>
<div v-if="chosen && line" class="drawer-backdrop"><aside class="drawer wide" role="dialog" aria-modal="true" aria-label="数量与位置"><div class="compact-selection"><img v-if="chosen.image" :src="chosen.image" :alt="chosen.item_name" class="thumb"><div><h2>{{chosen.item_name}}</h2><p>{{chosen.item_code}} · 总库存 {{chosen.total_stock}} {{chosen.stock_uom}}</p></div></div><form @submit.prevent="addLine"><label>数量 <span v-html="requiredMark"/><input type="number" min="0.000001" step="any" v-model.number="line.qty" required></label><label>单位 <span v-html="requiredMark"/><select v-model="line.uom" required><option :value="chosen.stock_uom">{{chosen.stock_uom}}</option><option v-for="u in chosen.uoms.filter((u:any)=>u.uom!==chosen.stock_uom)" :value="u.uom">{{u.uom}} ({{u.conversion_factor}} {{chosen.stock_uom}})</option></select></label><label v-if="isReceive">入库位置 <span v-html="requiredMark"/><select v-model="line.warehouse" required><option v-for="w in allowed" :value="w.name">{{label(w.name)}}</option></select></label><template v-else-if="form.movement_kind==='Return'"><p>来源位置：{{label(boot.settings.loan_warehouse)}}（系统借出库）</p></template><template v-else><h3>各位置库存</h3><button type="button" v-for="s in sourceOptions" @click="line.from_warehouse=s.warehouse;loadBatches()">{{label(s.warehouse)}} · {{s.actual_qty}} {{chosen.stock_uom}}</button><label>来源位置 <span v-html="requiredMark"/><select v-model="line.from_warehouse" required @change="loadBatches"><option value="">请选择有库存的位置</option><option v-for="s in sourceOptions" :value="s.warehouse">{{label(s.warehouse)}} · {{s.actual_qty}} {{chosen.stock_uom}}</option></select></label></template><label v-if="form.movement_kind==='Return'">结果<select v-model="line.outcome" @change="line.to_warehouse = line.outcome==='Damaged' ? boot.settings.damaged_warehouse : line.to_warehouse"><option value="Returned">正常归还</option><option value="Damaged">损坏待处理</option></select></label><label v-if="isTransfer && form.movement_kind!=='Loan'">目标位置 <span v-html="requiredMark"/><select v-model="line.to_warehouse" required><option v-for="w in allowed" :value="w.name">{{label(w.name)}}</option></select></label><template v-if="chosen.has_batch_no"><label v-if="isReceive && boot.capabilities.Batch"><input type="checkbox" v-model="line.new_batch" @change="line.batch_no=''">创建新批次</label><template v-if="line.new_batch"><label>批次编号（留空自动生成）<input v-model="line.batch_no"></label><label>生产日期<input type="date" v-model="line.manufacturing_date"></label><label>到期日期 <span v-if="chosen.has_expiry_date" v-html="requiredMark"/><input type="date" v-model="line.expiry_date" :required="!!chosen.has_expiry_date"></label></template><label v-else>批次 <span v-html="requiredMark"/><select v-model="line.batch_no" required><option value="">请选择批次</option><option v-for="b in batchRows" :value="b.name">{{b.name}} · {{b.expiry_date||'无到期日期'}} {{b.qty!=null?`· 库存 ${b.qty}`:''}}</option></select></label></template><button class="primary">{{editingIndex>=0?'更新':'添加'}}</button><button type="button" @click="chosen=undefined;line=undefined">取消</button></form></aside></div>
<div v-if="activityDialog" class="modal"><section role="dialog" aria-modal="true"><h2>选择活动</h2><label>搜索活动<input v-model="activitySearch"></label><div v-for="a in activities.filter((a:any)=>!activitySearch||a.title.includes(activitySearch))" :key="a.name"><button type="button" @click="form.activity=a.name;activityDialog=false;changed(true)">{{a.title}}（{{activityTypeLabel(a.activity_type)}}）</button></div><form v-if="!readonly && boot.capabilities['Inventory Activity']" @submit.prevent="createActivity"><h3>新建活动</h3><label>名称 <span v-html="requiredMark"/><input v-model="activity.title" required></label><label>类型 <span v-html="requiredMark"/><select v-model="activity.activity_type" required><option v-for="t in ['Distribution','Event','Performance','Religious Activity','Maintenance','Other']" :value="t">{{activityTypeLabel(t)}}</option></select></label><label>开始日期<input type="date" v-model="activity.start_date"></label><label>结束日期<input type="date" v-model="activity.end_date"></label><label>说明<textarea v-model="activity.description"/></label><button>创建并选择</button><button type="button" @click="activityDialog=false">取消</button></form></section></div>
<div v-if="review" class="modal"><section><h2>确认{{labels[form.movement_kind]}}</h2><p>{{postingTimeMode==='manual' ? `${form.posting_date} ${form.posting_time}` : '提交时使用当前时间'}}</p><p>{{form.source_text||form.purpose_text||form.borrower||''}}</p><p>{{form.items.length}} 行物品</p><div class="review-items"><div v-for="line in form.items" :key="line.id" class="compact-selection"><img v-if="catalog[line.item_code]?.image" :src="catalog[line.item_code].image" :alt="catalog[line.item_code]?.item_name" class="thumb"><span><b>{{catalog[line.item_code]?.item_name||line.item_code}}</b><small>{{line.qty}} {{line.uom}}<template v-if="line.batch_no"> · 批次 {{line.batch_no}}</template></small></span></div></div><p v-for="(qty,uom) in totals">{{qty}} {{uom}}</p><p v-for="g in groups">{{label(g.location)}} · {{g.lines.length}} 行</p><p>活动：{{form.activity||'无'}}</p><p>附件：{{record.attachments?.length||0}}</p><p>经手人：{{form.handler_name || '未填写'}}</p><p>系统记录用户：{{form.recorded_by || boot.user}}</p><p>鉴证人：{{form.no_independent_reviewer ? '无独立鉴证人' : (form.reviewer_name || '未填写')}}</p><p>{{form.handler_signature?'✓ 经手人已签名':'经手人尚未签名'}}</p><p v-if="error" class="error">{{error}}</p><button :disabled="confirming" @click="review=false">返回修改</button><button class="primary" :disabled="confirming" @click="confirm">{{confirming?'正在确认…':`确认${labels[form.movement_kind]}`}}</button></section></div>
</template></main></template>
