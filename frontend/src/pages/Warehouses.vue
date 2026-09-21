<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, warehouseLabelContract } from '../lib/api'
import { toast } from '../lib/toast'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import WarehouseTree from '../components/WarehouseTree.vue'

const boot = ref<any>(), summaries = ref<Record<string, any>>({}), allowed = ref<string[]>([])
const error = ref(''), summaryError = ref(''), notice = ref(''), selected = ref(''), loading = ref(true)
const repair = ref<{ fieldname: string; options: any[] } | null>(null), repairChoice = ref<any>()
const form = ref({ warehouse_name: '', parent_warehouse: '', warehouse_type: '房间', is_group: true })
const tree = computed(() => boot.value?.physical_tree || [])
const selectedNode = computed(() => tree.value.find((node: any) => node.name === selected.value))
const parents = computed(() => {
  const root = boot.value?.settings?.physical_root_warehouse
  return [...(root ? [{ name: root, warehouse_name: '实体仓库（根）', is_group: 1 }] : []), ...tree.value.filter((node: any) => node.is_group)]
})
const editParents = computed(() => {
  const node = selectedNode.value
  if (!node) return parents.value
  return parents.value.filter((candidate: any) => candidate.name !== node.name && !(candidate.lft >= node.lft && candidate.rgt <= node.rgt))
})
const status = computed(() => boot.value?.warehouse_management_status || [])
const canCreate = computed(() => Boolean(boot.value?.is_manager && parents.value.length))
const operationCaps = computed(() => boot.value?.stock_operation_capabilities || {})
const label = (name: string) => warehouseLabelContract(name, boot.value?.warehouse_tree || []).full_label

async function loadSummaries() {
  summaryError.value = ''
  try { const rows = await api('warehouse_summaries'); summaries.value = Object.fromEntries((rows || []).map((row: any) => [row.warehouse, row])) }
  catch (cause: any) { summaryError.value = `库存摘要加载失败：${cause.message}` }
}
async function load() {
  loading.value = true; error.value = ''
  try {
    const bootstrap = await api('warehouse_management_bootstrap')
    boot.value = bootstrap; allowed.value = (bootstrap.warehouses || []).map((row: any) => row.name)
    if (!selected.value) selected.value = tree.value[0]?.name || ''
    if (!form.value.parent_warehouse || !parents.value.some((node: any) => node.name === form.value.parent_warehouse)) form.value.parent_warehouse = parents.value[0]?.name || ''
    void loadSummaries()
  } catch (cause: any) { error.value = cause.message }
  finally { loading.value = false }
}
async function save() {
  if (!form.value.parent_warehouse) { error.value = '请先配置有效的实体仓库根目录或上级分组。'; return }
  try { await api('configure_warehouse', form.value); notice.value = '已保存'; toast('仓库已保存'); form.value.warehouse_name = ''; await load() }
  catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function saveAllowed() {
  try { await api('save_allowed_warehouses', { warehouses: allowed.value }); notice.value = '允许库存操作的位置已保存'; toast(notice.value) }
  catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function saveNode(node: any) {
  try { await api('configure_warehouse', { warehouse: node.name, warehouse_name: node.warehouse_name, warehouse_type: node.warehouse_type, parent_warehouse: node.parent_warehouse }); notice.value = '仓库设置已保存'; await load() }
  catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function previewAdoption() {
  try {
    const preview = await api('warehouse_adoption_preview', { warehouses: (boot.value?.adoption_candidates || []).map((row: any) => row.name) })
    const labels = (preview.changes || []).map((row: any) => row.warehouse_name).join('、')
    if (!window.confirm(`将以下仓库纳入实体仓库根目录，库存流水和仓库名称不会变更：${labels}。是否继续？`)) return
    await api('adopt_warehouses', { warehouses: (preview.changes || []).map((row: any) => row.name), confirmed: 1 })
    notice.value = '旧仓库已纳入实体仓库树'; await load()
  } catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function previewRepair(fieldname: string) {
  try {
    repair.value = await api('warehouse_setting_repair_preview', { fieldname }); repairChoice.value = repair.value?.options?.[0]
  } catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function applyRepair() {
  if (!repair.value) return
  const choice = repairChoice.value
  if (!choice || !window.confirm(`将 ${repair.value.fieldname === 'root_warehouse' ? '寺院' : '实体'}仓库根目录修复为“${choice.warehouse_name}”。只修改设置引用，不移动库存。是否继续？`)) return
  try {
    await api('repair_warehouse_setting', { fieldname: repair.value.fieldname, warehouse: choice.name, confirmed: 1 })
    repair.value = null; notice.value = '仓库根目录设置已修复'; await load()
  } catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
function action(kind: string, node: any) {
  if (node.is_group) sessionStorage.setItem(`ti-scope:${kind}`, JSON.stringify({ group: node.name }))
  const suffix = node.is_group ? '' : `?warehouse=${encodeURIComponent(node.name)}`
  void location.assign(`/inventory/new/${kind}${suffix}`)
}
onMounted(load)
</script>

<template>
  <section class="app-shell wide-shell">
    <header><h1>仓库</h1><button v-if="boot?.is_manager" type="button" @click="selected = ''">添加房间 / 位置</button></header>
    <LoadingIndicator v-if="loading" text="正在加载仓库…" />
    <template v-else>
      <p v-if="error" class="error">{{ error }} <button type="button" @click="load">重试</button></p>
      <p v-if="notice" class="notice">{{ notice }}</p>
      <p v-for="row in status" :key="row.code" :class="row.level === 'error' ? 'error' : 'notice'">{{ row.message }} <button v-if="boot?.is_manager && row.action?.operation === 'preview_adoption'" type="button" @click="previewAdoption">预览采用</button><button v-else-if="boot?.is_manager && row.action?.type === 'repair'" type="button" @click="previewRepair(row.action.operation === 'repair_root' ? 'root_warehouse' : 'physical_root_warehouse')">预览修复</button><a v-else-if="boot?.is_manager && row.action?.href" :href="row.action.href" target="_blank" rel="noopener">{{ row.action.type === 'permission' ? '查看权限设置' : '打开库存设置' }}</a></p>
      <div v-if="repair" class="notice"><strong>根目录修复预览</strong><select v-model="repairChoice" aria-label="选择根目录"><option v-for="option in repair.options" :key="option.name" :value="option">{{ option.warehouse_name }}</option></select><button type="button" :disabled="!repairChoice" @click="applyRepair">确认修复</button><button type="button" @click="repair = null; repairChoice = undefined">取消</button></div>

      <button v-if="boot?.is_manager && boot?.adoption_candidates?.length" type="button" @click="previewAdoption">预览并采用 {{ boot.adoption_candidates.length }} 个旧仓库分支</button>
      <p>仅显示实体仓库；虚拟、借出、损坏和未定位系统仓库不会出现在这里。</p>
      <p v-if="summaryError" class="notice">{{ summaryError }} <button type="button" @click="loadSummaries">重试摘要</button></p>
      <div class="warehouse-browser">
        <nav v-if="tree.length"><WarehouseTree :nodes="tree" :tree="boot.warehouse_tree" :selected="selected" :summaries="summaries" @select="selected = $event" /></nav>
        <section v-if="selectedNode" class="settings-detail">
          <h2>{{ label(selectedNode.name) }}</h2>
          <p>{{ selectedNode.is_group ? '这是分组；库存操作会要求选择实际叶子位置。' : '这是实际库存位置。' }}</p>
          <p>{{ summaries[selectedNode.name]?.distinct_products || 0 }} 种物品<template v-if="summaries[selectedNode.name]?.quantities?.length"> · {{ summaries[selectedNode.name].quantities.map((value: any) => `${value.qty} ${value.uom}`).join(' · ') }}</template></p>
          <div class="detail-actions"><template v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan']" :key="kind"><button v-if="operationCaps[kind]" type="button" @click="action(kind, selectedNode)">{{ ({ Receive: '入库', Issue: '出库', Transfer: '转移', Loan: '借出' } as any)[kind] }}</button></template></div>
          <template v-if="boot.is_manager"><h3>管理员设置</h3><label>名称<input v-model="selectedNode.warehouse_name"></label><label>类型<select v-model="selectedNode.warehouse_type"><option value="地点">地点</option><option value="房间">房间</option><option value="库位">库位</option></select></label><label>上级分组<select v-model="selectedNode.parent_warehouse"><option v-for="parent in editParents" :key="parent.name" :value="parent.name">{{ label(parent.name) }}</option></select></label><button type="button" @click="saveNode(selectedNode)">保存仓库设置</button><label v-if="!selectedNode.is_group"><input v-model="allowed" type="checkbox" :value="selectedNode.name">允许库存操作</label><button v-if="!selectedNode.is_group" type="button" @click="saveAllowed">保存允许的位置</button></template>
        </section>
        <form v-else-if="canCreate" class="settings-detail" @submit.prevent="save"><h2>添加房间 / 位置</h2><label>名称<input v-model="form.warehouse_name" required></label><label>上级<select v-model="form.parent_warehouse" required><option v-for="node in parents" :key="node.name" :value="node.name">{{ label(node.name) }}</option></select></label><label>类型<select v-model="form.warehouse_type"><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option></select></label><label><input v-model="form.is_group" type="checkbox">包含下级位置</label><button type="submit">保存</button></form>
        <p v-else-if="boot?.is_manager" class="empty-state">请先在设置中修复实体仓库根目录，随后即可在这里建立第一个房间或库位。</p>
        <p v-else-if="!tree.length" class="empty-state">目前没有可查看的实体仓库。请联系管理员完成仓库设置或授予查看权限。</p>
      </div>
    </template>
  </section>
</template>
