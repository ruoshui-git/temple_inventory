<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, warehouseLabel } from '../lib/api'
import LoadingIndicator from '../components/LoadingIndicator.vue'

const boot = ref<any>()
const error = ref('')
const notice = ref('')
const allowed = ref<string[]>([])
const fresh = ref({ warehouse_name: '', parent_warehouse: '', warehouse_type: '房间', is_group: false })
const sampleBusy = ref(false)
async function installSamples() { sampleBusy.value = true; try { await api('start_sample_install', { company: boot.value.settings.company }); notice.value = '样例数据安装已排队'; await load() } catch (e: any) { error.value = e.message } finally { sampleBusy.value = false } }

async function load() {
  try {
    boot.value = await api('bootstrap')
    allowed.value = boot.value.warehouses.map((warehouse: any) => warehouse.name)
    fresh.value.parent_warehouse = boot.value.settings.root_warehouse
  } catch (e: any) {
    error.value = e.message
  }
}

async function action(method: string, args: any = {}) {
  error.value = ''
  notice.value = ''
  try {
    await api(method, args)
    await load()
    notice.value = '已保存'
  } catch (e: any) {
    error.value = e.message
  }
}

onMounted(load)
</script>

<template>
  <main class="app-shell">
    <header><RouterLink to="/">‹ 首页</RouterLink><h1>库存设置</h1></header>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="notice">{{ notice }}</p>
    <LoadingIndicator v-if="!boot && !error" text="正在加载设置…" />
    <template v-else-if="boot?.is_manager">
      <h2>完整样例数据</h2><p>仅可在没有库存流水和业务记录的站点安装。</p><button class="primary" :disabled="sampleBusy || boot?.settings.sample_data_status === 'Installing'" @click="installSamples">{{sampleBusy ? '正在排队…' : `安装完整样例数据（${boot?.settings.sample_data_status || '未安装'}）`}}</button><h2>房间与位置</h2>
      <p>分类不会改变仓库层级或库存。只有叶子仓库可以存放物品。</p>
      <article v-for="warehouse in boot.warehouse_tree" :key="warehouse.name" class="selection-row">
        <b>{{ warehouseLabel(warehouse.name, boot.warehouse_tree) }} {{ warehouse.is_group ? '（组）' : '' }}</b>
        <select :value="warehouse.warehouse_type || ''" @change="action('configure_warehouse', { warehouse: warehouse.name, warehouse_type: ($event.target as HTMLSelectElement).value })">
          <option value="">未分类</option><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option>
        </select>
        <label v-if="!warehouse.is_group"><input v-model="allowed" type="checkbox" :value="warehouse.name">允许库存操作</label>
      </article>
      <button @click="action('save_allowed_warehouses', { warehouses: allowed })">保存允许的位置</button>
      <h2>添加房间 / 位置</h2>
      <form @submit.prevent="action('configure_warehouse', fresh)">
        <label>名称 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="fresh.warehouse_name" required></label>
        <label>上级仓库<select v-model="fresh.parent_warehouse"><option v-for="warehouse in (boot.physical_tree || boot.warehouse_tree).filter((row: any) => row.is_group)" :key="warehouse.name" :value="warehouse.name">{{ warehouse.warehouse_name }}</option></select></label>
        <label>分类<select v-model="fresh.warehouse_type"><option value="房间">房间</option><option value="库位">库位</option><option value="地点">地点</option></select></label>
        <label><input v-model="fresh.is_group" type="checkbox">包含下级位置（组仓库）</label>
        <button>创建</button>
      </form>
    </template>
    <p v-else-if="boot">需要系统管理员权限。</p>
  </main>
</template>
