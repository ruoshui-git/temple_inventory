<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, warehouseLabel } from '../lib/api'
import LoadingIndicator from '../components/LoadingIndicator.vue'

const boot = ref<any>()
const error = ref('')
const notice = ref('')
const allowed = ref<string[]>([])
const selected = ref('')
const expanded = ref<Record<string, boolean>>({})
const fresh = ref({ warehouse_name: '', parent_warehouse: '', warehouse_type: '房间', is_group: false })

const rows = computed(() => {
  const tree = boot.value?.warehouse_tree || []
  const byName = new Map<string, any>(tree.map((row: any) => [row.name, row] as [string, any]))
  return [...tree].sort((a: any, b: any) => (a.lft || 0) - (b.lft || 0)).map((row: any) => {
    let depth = 0
    let parent = row.parent_warehouse
    while (parent && byName.has(parent)) {
      depth += 1
      parent = byName.get(parent)?.parent_warehouse
    }
    return { ...row, depth }
  })
})
const visibleRows = computed(() => rows.value.filter((row: any) => {
  let parent = row.parent_warehouse
  while (parent) {
    if (expanded.value[parent] === false) return false
    parent = rows.value.find((candidate: any) => candidate.name === parent)?.parent_warehouse
  }
  return true
}))
const selectedWarehouse = computed(() => rows.value.find((row: any) => row.name === selected.value))
const parentOptions = computed(() => rows.value.filter((row: any) => row.is_group && !(boot.value?.settings?.leased_warehouse === row.name)))

async function load() {
  try {
    boot.value = await api('bootstrap')
    allowed.value = boot.value.warehouses.map((warehouse: any) => warehouse.name)
    fresh.value.parent_warehouse = boot.value.settings.root_warehouse
    if (!selected.value) selected.value = rows.value[0]?.name || ''
    for (const row of rows.value) if (row.is_group && expanded.value[row.name] === undefined) expanded.value[row.name] = true
  } catch (cause: any) {
    error.value = cause.message
  }
}
async function action(method: string, args: any = {}) {
  error.value = ''
  notice.value = ''
  try {
    await api(method, args)
    await load()
    notice.value = '已保存'
  } catch (cause: any) {
    error.value = cause.message
  }
}
function toggle(name: string) {
  expanded.value[name] = expanded.value[name] === false
}
onMounted(load)
</script>

<template>
  <main class="app-shell wide-shell">
    <header><RouterLink to="/">‹ 首页</RouterLink><h1>库存设置</h1></header>
    <p v-if="error" class="error">{{ error }}</p><p v-if="notice" class="notice">{{ notice }}</p>
    <LoadingIndicator v-if="!boot && !error" text="正在加载设置…" />
    <template v-else-if="boot?.is_manager">
      <h2>房间与位置</h2><p>分类不会改变仓库层级或库存。只有叶子仓库可以存放物品。</p>
      <div class="settings-layout">
        <nav class="warehouse-settings-tree" aria-label="仓库层级">
          <div v-for="warehouse in visibleRows" :key="warehouse.name" class="settings-node" :class="{ selected: selected === warehouse.name }" :style="{ paddingLeft: (12 + warehouse.depth * 18) + 'px' }" role="button" tabindex="0" @click="selected = warehouse.name" @keydown.enter.prevent="selected = warehouse.name" @keydown.space.prevent="selected = warehouse.name">
            <button v-if="warehouse.is_group" type="button" class="tree-toggle" :aria-label="(expanded[warehouse.name] ? '收起' : '展开') + ' ' + warehouse.warehouse_name" @click.stop="toggle(warehouse.name)">{{ expanded[warehouse.name] ? '−' : '+' }}</button><span v-else class="tree-spacer"></span>{{ warehouse.warehouse_name }}<small v-if="warehouse.is_group">分组</small>
          </div>
        </nav>
        <section v-if="selectedWarehouse" class="settings-detail" aria-live="polite">
          <h3>{{ warehouseLabel(selectedWarehouse.name, boot.warehouse_tree) }}</h3>
          <p>{{ selectedWarehouse.is_group ? '这是组织分组，不能直接存放库存。' : '这是可存放库存的叶子位置。' }}</p>
          <label>仓库类型<select :value="selectedWarehouse.warehouse_type || ''" @change="action('configure_warehouse', { warehouse: selectedWarehouse.name, warehouse_type: ($event.target as HTMLSelectElement).value })"><option value="">未分类</option><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option></select></label>
          <label v-if="!selectedWarehouse.is_group"><input v-model="allowed" type="checkbox" :value="selectedWarehouse.name">允许库存操作</label>
        </section>
      </div>
      <button type="button" @click="action('save_allowed_warehouses', { warehouses: allowed })">保存允许的位置</button>
      <h2>添加房间 / 位置</h2>
      <form @submit.prevent="action('configure_warehouse', fresh)">
        <label>名称 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="fresh.warehouse_name" required></label>
        <label>上级仓库<select v-model="fresh.parent_warehouse"><option v-for="warehouse in parentOptions" :key="warehouse.name" :value="warehouse.name">{{ warehouseLabel(warehouse.name, boot.warehouse_tree) }}</option></select></label>
        <label>分类<select v-model="fresh.warehouse_type"><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option></select></label>
        <label><input v-model="fresh.is_group" type="checkbox">包含下级位置（组仓库）</label><button type="submit">创建</button>
      </form>
    </template>
    <p v-else-if="boot">需要系统管理员权限。</p>
  </main>
</template>
