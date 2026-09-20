<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, warehouseLabel } from '../lib/api'
import { toast } from '../lib/toast'
import WarehouseTree from '../components/WarehouseTree.vue'

const boot = ref<any>(), summaries = ref<Record<string, any>>({}), allowed = ref<string[]>([]), error = ref(''), notice = ref(''), selected = ref('')
const form = ref({ warehouse_name: '', parent_warehouse: '', warehouse_type: '房间', is_group: true })
const tree = computed(() => boot.value?.physical_tree || [])
const selectedNode = computed(() => tree.value.find((node: any) => node.name === selected.value))
const parents = computed(() => [{ name: boot.value?.settings?.physical_root_warehouse, warehouse_name: '实体仓库（根）', is_group: 1 }, ...tree.value.filter((node: any) => node.is_group)])
async function load() {
  try {
    const [bootstrap, rows] = await Promise.all([api('bootstrap'), api('warehouse_summaries')])
    boot.value = bootstrap
    allowed.value = (bootstrap.warehouses || []).map((row: any) => row.name)
    summaries.value = Object.fromEntries((rows || []).map((row: any) => [row.warehouse, row]))
    if (!selected.value) selected.value = tree.value[0]?.name || ''
    if (!form.value.parent_warehouse) form.value.parent_warehouse = parents.value[0]?.name || ''
  } catch (cause: any) { error.value = cause.message }
}
async function save() {
  try { await api('configure_warehouse', form.value); notice.value = '已保存'; toast('仓库已保存'); form.value.warehouse_name = ''; await load() }
  catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
async function saveAllowed() {
  try { await api('save_allowed_warehouses', { warehouses: allowed.value }); notice.value = '允许库存操作的位置已保存'; toast(notice.value) }
  catch (cause: any) { error.value = cause.message; toast(cause.message, 'error') }
}
function action(kind: string, node: any) {
  if (node.is_group) sessionStorage.setItem(`ti-scope:${kind}`, JSON.stringify({ group: node.name }))
  const suffix = node.is_group ? '' : `?warehouse=${encodeURIComponent(node.name)}`
  void location.assign(`/inventory/new/${kind}${suffix}`)
}
</script>

<template>
  <section class="app-shell wide-shell"><header><h1>仓库</h1><button v-if="boot?.is_manager" type="button" @click="selected = ''">添加房间 / 位置</button></header><p v-if="error" class="error">{{ error }} <button type="button" @click="load">重试</button></p><p v-if="notice" class="notice">{{ notice }}</p><p>仅显示实体仓库；虚拟、借出、损坏和未定位系统仓库不会出现在这里。</p><div class="warehouse-browser"><nav v-if="tree.length"><WarehouseTree :nodes="tree" :tree="boot.warehouse_tree" :selected="selected" :summaries="summaries" @select="selected = $event" /></nav><section v-if="selectedNode" class="settings-detail"><h2>{{ warehouseLabel(selectedNode.name, boot.warehouse_tree) }}</h2><p>{{ selectedNode.is_group ? '这是分组；库存操作会要求选择实际叶子位置。' : '这是实际库存位置。' }}</p><p>{{ summaries[selectedNode.name]?.distinct_products || 0 }} 种物品<template v-if="summaries[selectedNode.name]?.quantities?.length"> · {{ summaries[selectedNode.name].quantities.map((value: any) => `${value.qty} ${value.uom}`).join(' · ') }}</template></p><p v-if="summaries[selectedNode.name]?.item_groups?.length">类别：{{ summaries[selectedNode.name].item_groups.join('、') }}<template v-if="summaries[selectedNode.name]?.additional_groups">；另有 {{ summaries[selectedNode.name].additional_groups }} 类</template></p><div class="detail-actions"><button v-for="kind in ['Receive', 'Issue', 'Transfer', 'Loan']" :key="kind" type="button" @click="action(kind, selectedNode)">{{ ({ Receive: '入库', Issue: '出库', Transfer: '转移', Loan: '借出' } as any)[kind] }}</button></div><template v-if="boot.is_manager"><h3>管理员设置</h3><label>名称<input v-model="selectedNode.warehouse_name" @change="api('configure_warehouse', { warehouse: selectedNode.name, warehouse_name: selectedNode.warehouse_name, warehouse_type: selectedNode.warehouse_type })"></label><label>类型<select v-model="selectedNode.warehouse_type" @change="api('configure_warehouse', { warehouse: selectedNode.name, warehouse_type: selectedNode.warehouse_type })"><option value="地点">地点</option><option value="房间">房间</option><option value="库位">库位</option></select></label><label v-if="!selectedNode.is_group"><input v-model="allowed" type="checkbox" :value="selectedNode.name">允许库存操作</label><button v-if="!selectedNode.is_group" type="button" @click="saveAllowed">保存允许的位置</button></template></section><form v-else-if="boot?.is_manager" class="settings-detail" @submit.prevent="save"><h2>添加房间 / 位置</h2><label>名称<input v-model="form.warehouse_name" required></label><label>上级<select v-model="form.parent_warehouse"><option v-for="node in parents" :key="node.name" :value="node.name">{{ warehouseLabel(node.name, boot.warehouse_tree) }}</option></select></label><label>类型<select v-model="form.warehouse_type"><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option></select></label><label><input v-model="form.is_group" type="checkbox">包含下级位置</label><button type="submit">保存</button></form></div></section>
</template>
