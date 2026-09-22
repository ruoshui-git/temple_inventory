<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, upload, workspaceApi } from '../lib/api'
import { warehousePresentation } from '../lib/warehousePresenter'
import AttachmentList from '../components/AttachmentList.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import Scanner from '../components/Scanner.vue'
import { toast } from '../lib/toast'
import { returnToOpener } from '../lib/navigation'

const route = useRoute(), router = useRouter(), item = ref<any>(), boot = ref<any>(), error = ref(''), chosen = ref(''), editing = ref(false), saving = ref(false), scanner = ref(false)
const selectedImage = computed(() => item.value?.images?.find((image: any) => image.file_url === chosen.value) || item.value?.images?.[0])
const itemGroups = computed(() => (boot.value?.item_groups || []).filter((group: any) => group.name !== 'All Item Groups'))
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const warehouseText = (name: string) => warehousePresentation(name, boot.value?.warehouse_tree || []).breadcrumb
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
    <header><button type="button" @click="close">‹ 返回</button><h1>物品详情</h1><button v-if="item?.can_edit" type="button" @click="editing = !editing">{{ editing ? '取消编辑' : '编辑' }}</button></header>
    <p v-if="error" class="error">{{ error }} <button type="button" @click="router.go(0)">重试</button></p><LoadingIndicator v-if="!item && !error" text="正在加载物品…"/>
    <template v-else-if="item">
      <form v-if="editing" class="settings-detail" @submit.prevent="saveEdit"><h2>编辑物品资料</h2><label>名称<input v-model="item.item_name" required></label><label>类别<select v-model="item.item_group"><option v-for="group in itemGroups" :key="group.name" :value="group.name">{{ group.item_group_name }}</option></select></label><label>说明<textarea v-model="item.description"/></label><label>条码（每行一个）<textarea v-model="item.barcodes"/></label><div class="detail-actions"><button type="button" @click="scanner = true">扫描添加条码</button><button class="primary" :disabled="saving">{{ saving ? '正在保存…' : '保存资料' }}</button></div></form>
      <Scanner v-if="editing && scanner" presentation="modal" @scan="addBarcode" @close="scanner = false"/>
      <section v-if="selectedImage" class="item-gallery"><img class="item-gallery-hero" :src="selectedImage.file_url" :alt="item.item_name"><div class="gallery-thumbs"><button v-for="image in item.images" :key="image.file_url" type="button" :class="{ selected: image.file_url === chosen }" :aria-label="`查看 ${image.file_name}`" @click="chosen = image.file_url"><img :src="image.file_url" :alt="image.file_name"></button></div></section>
      <h2>{{ item.item_name }}</h2><p>{{ item.item_code }} · {{ item.item_group }} · {{ item.stock_uom }}</p><p>{{ item.description }}</p><p>可用 {{ item.available_stock }} · 总计 {{ item.total_stock }} · 借出 {{ item.on_loan_qty }} · 损坏 {{ item.damaged_qty }} · 未定位 {{ item.pending_qty }} {{ item.stock_uom }}</p>
      <div class="detail-actions"><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan', 'Damage']" :key="kind"><button v-if="operationCaps[kind]" type="button" @click="operation(kind)">{{ ({ Receive: '入库', Issue: '出库', Transfer: '转移', Loan: '借出', Damage: '标记损坏' } as any)[kind] }}</button></template></div>
      <h2>库存位置</h2><p v-if="!item.stock.length" class="empty-state">暂无库存位置记录</p><div v-for="stock in item.stock" :key="stock.warehouse" class="selection-row">{{ warehouseText(stock.warehouse) }} <b>{{ stock.actual_qty }} {{ item.stock_uom }}</b></div>
      <details v-if="item.batches?.length"><summary>批次与有效期</summary><p v-for="batch in item.batches" :key="batch.batch_no">{{ batch.batch_no }} · {{ batch.expiry_date || '无有效期' }} · {{ batch.qty }} {{ item.stock_uom }}</p></details><details v-if="item.active_loans?.length"><summary>未结借用</summary><RouterLink v-for="loan in item.active_loans" :key="loan.loan_item" :to="`/loans/${encodeURIComponent(loan.loan)}`">{{ loan.borrower || loan.loan }} · {{ loan.outstanding }} {{ loan.uom }}</RouterLink></details>
      <AttachmentList :attachments="item.attachments" :editable="Boolean(item.can_edit && editing)" :allow-primary-image="true" :primary-url="item.image" @upload="uploadAttachments" @remove="removeFile" @set-primary="setPrimary" />
      <h2 v-if="item.history?.length">最近库存变动</h2><RouterLink v-for="row in item.history" :key="row.name" class="selection-row" :to="row.document_type === 'Stock Reconciliation' ? `/reconcile/${encodeURIComponent(row.name)}` : row.legacy ? `/entry/${encodeURIComponent(row.name)}` : `/workspace/${row.name}`">{{ row.posting_date }} · {{ row.movement_kind }}</RouterLink>
    </template>
  </section>
</template>
