<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, upload, workspaceApi } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import AttachmentList from '../components/AttachmentList.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import Scanner from '../components/Scanner.vue'
import IconButton from '../components/IconButton.vue'
import { toast } from '../lib/toast'
import { returnToOpener } from '../lib/navigation'
import { formatExpiryDuration } from '../lib/duration'

const route = useRoute(), router = useRouter(), item = ref<any>(), boot = ref<any>(), error = ref(''), chosen = ref(''), editing = ref(false), saving = ref(false), scanner = ref(false)
const selectedImage = computed(() => item.value?.images?.find((image: any) => image.file_url === chosen.value) || item.value?.images?.[0])
const itemGroups = computed(() => (boot.value?.item_groups || []).filter((group: any) => group.name !== 'All Item Groups'))
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const warehouseText = (name: string) => warehousePresentation(name, boot.value?.warehouse_tree || []).breadcrumb
const batchSort = ref<'expiry_date' | 'total_qty'>('expiry_date')
const batchSortOrder = ref<'asc' | 'desc'>('asc')
const batches = computed(() => [...(item.value?.batches || [])].sort((a: any, b: any) => {
  const left = batchSort.value === 'expiry_date' ? String(a.expiry_date || '9999-12-31') : Number(a.total_qty ?? a.qty ?? 0)
  const right = batchSort.value === 'expiry_date' ? String(b.expiry_date || '9999-12-31') : Number(b.total_qty ?? b.qty ?? 0)
  const result = left < right ? -1 : left > right ? 1 : String(a.batch_no).localeCompare(String(b.batch_no))
  return batchSortOrder.value === 'asc' ? result : -result
}))
function toggleBatchSort(column: 'expiry_date' | 'total_qty') { if (batchSort.value === column) batchSortOrder.value = batchSortOrder.value === 'asc' ? 'desc' : 'asc'; else { batchSort.value = column; batchSortOrder.value = 'asc' } }
const batchSelected = (batch: any) => String(route.query.batch || '') === String(batch.batch_no)
const signedChange = (value: number) => `${value > 0 ? '+' : ''}${value}`
function operation(kind: string) { sessionStorage.setItem(`ti-seed:${kind}`, JSON.stringify({ items: [item.value?.item_code] })); void router.push(`/new/${kind}`) }
function addBarcode(value: string) { const codes = String(item.value?.barcodes || '').split(/[\n,]/).map((code: string) => code.trim()).filter(Boolean); if (!codes.includes(value)) item.value.barcodes = [...codes, value].join('\n'); scanner.value = false }
function close() { void returnToOpener(router, '/') }
async function saveEdit() { if (!item.value) return; saving.value = true; try { const value = await api('update_item', { item_code: item.value.item_code, data: { item_name: item.value.item_name, item_group: item.value.item_group, description: item.value.description, image: item.value.image, barcodes: String(item.value.barcodes || '').split(/[\n,]/).map((code: string) => code.trim()).filter(Boolean) } }); Object.assign(item.value, value, { barcodes: (value.barcodes || []).join('\n') }); editing.value = false; toast('物品资料已保存') } catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') } finally { saving.value = false } }
async function uploadAttachments(files: File[]) { try { for (const file of files) await upload(file, 'Item', item.value.item_code); item.value = await workspaceApi('item_detail', { item_code: item.value.item_code }) } catch (cause: any) { error.value = cause.message } }
async function setPrimary(file: any) { try { await api('set_item_image', { item_code: item.value.item_code, image: file.file_url }); item.value = await workspaceApi('item_detail', { item_code: item.value.item_code }); chosen.value = file.file_url; toast('主图已更新') } catch (cause: any) { error.value = cause.message } }
async function removeFile(file: any) { try { if (file.file_url === item.value.image && !window.confirm('此文件是主图，确定清除主图并删除吗？')) return; item.value = await workspaceApi('remove_item_attachment', { item_code: item.value.item_code, file_name: file.name, clear_primary: file.file_url === item.value.image ? 1 : 0 }) } catch (cause: any) { error.value = cause.message } }
onMounted(async () => { try { [boot.value, item.value] = await Promise.all([api('bootstrap'), workspaceApi('item_detail', { item_code: route.params.code })]); item.value.barcodes = (item.value.barcodes || []).join('\n'); chosen.value = item.value.images?.[0]?.file_url || '' } catch (cause: any) { error.value = cause.message } })
</script>

<template>
  <section class="app-shell wide-shell">
    <header><IconButton label="返回" @click="close"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h11" /></svg></IconButton><h1>物品详情</h1><IconButton v-if="item?.can_edit" :label="editing ? '取消编辑' : '编辑'" @click="editing = !editing"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16.5V20h3.5L18 9.5 14.5 6 4 16.5ZM13.5 7l3.5 3.5" /></svg></IconButton></header>
    <p v-if="error" class="error">{{ error }} <button type="button" @click="router.go(0)">重试</button></p><LoadingIndicator v-if="!item && !error" text="正在加载物品…"/>
    <template v-else-if="item">
      <form v-if="editing" class="settings-detail" @submit.prevent="saveEdit"><h2>编辑物品资料</h2><label>名称<input v-model="item.item_name" required></label><label>类别<select v-model="item.item_group"><option v-for="group in itemGroups" :key="group.name" :value="group.name">{{ group.item_group_name }}</option></select></label><label>说明<textarea v-model="item.description"/></label><label>条码（每行一个）<textarea v-model="item.barcodes"/></label><div class="detail-actions"><button type="button" @click="scanner = true">扫描添加条码</button><button class="primary" :disabled="saving">{{ saving ? '正在保存…' : '保存资料' }}</button></div></form>
      <Scanner v-if="editing && scanner" presentation="modal" @scan="addBarcode" @close="scanner = false"/>
      <section v-if="selectedImage" class="item-gallery"><img class="item-gallery-hero" :src="selectedImage.file_url" :alt="item.item_name"><div v-if="(item.images || []).length > 1" class="gallery-thumbs"><button v-for="image in item.images" :key="image.file_url" type="button" :class="{ selected: image.file_url === chosen }" :aria-label="`查看 ${image.file_name}`" @click="chosen = image.file_url"><img :src="image.file_url" :alt="image.file_name"></button></div></section>
      <h2>{{ item.item_name }}</h2><p>{{ item.item_code }} · {{ item.item_group }} · {{ item.stock_uom }}</p><p>{{ item.description }}</p><p>可用 {{ item.available_stock }} · 总计 {{ item.total_stock }} · 借出 {{ item.on_loan_qty }} · 损坏 {{ item.damaged_qty }} · 未定位 {{ item.pending_qty }} {{ item.stock_uom }}</p>
      <div class="detail-actions"><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan', 'Damage']" :key="kind"><button v-if="operationCaps[kind]" type="button" @click="operation(kind)">{{ ({ Receive: '入库', Issue: '出库', Transfer: '转移', Loan: '借出', Damage: '标记损坏' } as any)[kind] }}</button></template></div>
      <section v-if="item.has_batch_no" class="item-batches"><h2>批次与有效期</h2><p v-if="!batches.length" class="empty-state">暂无有库存的批次</p><div class="batch-desktop-table"><table><thead><tr><th>Batch ID</th><th :aria-sort="batchSort === 'expiry_date' ? (batchSortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"><button type="button" aria-label="按到期日期排序" @click="toggleBatchSort('expiry_date')">到期日期</button></th><th>剩余</th><th :aria-sort="batchSort === 'total_qty' ? (batchSortOrder === 'asc' ? 'ascending' : 'descending') : 'none'"><button type="button" aria-label="按数量排序" @click="toggleBatchSort('total_qty')">数量</button></th><th>位置</th></tr></thead><tbody><tr v-for="batch in batches" :key="batch.batch_no" :class="{ selected: batchSelected(batch), expired: batch.days_to_expiry < 0 }"><td>{{ batch.batch_no }}</td><td>{{ batch.expiry_date || '无有效期' }}</td><td>{{ batch.days_to_expiry == null ? '—' : formatExpiryDuration(batch.days_to_expiry) }}</td><td>{{ batch.total_qty ?? batch.qty }} {{ item.stock_uom }}</td><td><span v-for="location in batch.locations || []" :key="location.warehouse">{{ warehouseText(location.warehouse) }}：{{ location.qty }}<br></span></td></tr></tbody></table></div><div v-for="batch in batches" :key="'card-' + batch.batch_no" class="batch-card" :class="{ selected: batchSelected(batch), expired: batch.days_to_expiry < 0 }"><b>{{ batch.batch_no }}</b><span>{{ batch.expiry_date || '无有效期' }}<template v-if="batch.days_to_expiry != null"> · {{ formatExpiryDuration(batch.days_to_expiry) }}</template></span><strong>{{ batch.total_qty ?? batch.qty }} {{ item.stock_uom }}</strong><small v-for="location in batch.locations || []" :key="location.warehouse">{{ warehouseText(location.warehouse) }}：{{ location.qty }} {{ item.stock_uom }}</small></div></section><template v-else><h2>库存位置</h2><p v-if="!item.stock.length" class="empty-state">暂无库存位置记录</p><div v-for="stock in item.stock" :key="stock.warehouse" class="selection-row">{{ warehouseText(stock.warehouse) }} <b>{{ stock.actual_qty }} {{ item.stock_uom }}</b></div></template>
      <details v-if="item.active_loans?.length"><summary>未结借用</summary><RouterLink v-for="loan in item.active_loans" :key="loan.loan_item" :to="`/loans/${encodeURIComponent(loan.loan)}`">{{ loan.borrower || loan.loan }} · {{ loan.outstanding }} {{ loan.uom }}</RouterLink></details>
      <AttachmentList :attachments="item.attachments" :editable="Boolean(item.can_edit && editing)" :allow-primary-image="true" :primary-url="item.image" @upload="uploadAttachments" @remove="removeFile" @set-primary="setPrimary" />
      <h2 v-if="item.history?.length">最近库存变动</h2><RouterLink v-for="row in item.history" :key="row.name" class="selection-row recent-change" :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`"><b>{{ row.posting_date }} · {{ row.movement_kind }}</b><template v-if="row.item_changes?.length"><span v-for="change in row.item_changes" :key="`${change.warehouse}:${change.uom}`" :class="change.delta < 0 ? 'negative-change' : 'positive-change'">{{ warehouseText(change.warehouse) }} {{ signedChange(change.delta) }} {{ change.uom }}</span></template><span v-else>此记录没有可显示的物品变动明细</span></RouterLink>
    </template>
  </section>
</template>
