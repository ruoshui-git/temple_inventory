<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { FrappeUIProvider } from 'frappe-ui'
import { api, refreshSession, sessionExpired } from './lib/api'
import { applyUpdate, registerPwa, updateAvailable } from './lib/pwa'

const route = useRoute()
const status = ref<any>()
const checking = ref(true)
const error = ref('')
const selectedCompany = ref('')
const setupBusy = ref(false)
const repairBusy = ref(false)
const contentKey = ref(0)

async function check() {
  checking.value = true
  error.value = ''
  try {
    const value = await api('initialization_status')
    status.value = value
    selectedCompany.value = value.selected_company || ''
  } catch (e: any) {
    status.value = { setup_required: true, blockers: [{ message: e.message }], warnings: [] }
  } finally {
    checking.value = false
  }
}

async function initialize(includeExamples: boolean) {
  if (!selectedCompany.value) return
  setupBusy.value = true
  error.value = ''
  try {
    await api('initialize_warehouses', { company: selectedCompany.value, include_examples: includeExamples ? 1 : 0 })
    await check()
    contentKey.value++
  } catch (e: any) {
    error.value = e.message
  } finally {
    setupBusy.value = false
  }
}

async function repair() {
  repairBusy.value = true
  error.value = ''
  try {
    await api('repair_settings')
    await check()
    contentKey.value++
  } catch (e: any) {
    error.value = e.message
  } finally {
    repairBusy.value = false
  }
}

async function resume() {
  try {
    await refreshSession()
    await check()
  } catch (e: any) {
    error.value = e.message
  }
}

onMounted(() => { void check(); void registerPwa() })
</script>

<template>
  <FrappeUIProvider>
    <main v-if="checking" class="app-shell"><p>正在检查库存系统配置…</p></main>
    <main v-else-if="status?.setup_required" class="app-shell">
      <header><h1>物资管理需要先完成设置</h1></header>
      <ul><li v-for="issue in status.blockers || []" :key="issue.code">{{ issue.message }}</li></ul>
      <template v-if="status?.is_manager">
        <template v-if="status?.companies?.length">
          <label>公司
            <select v-model="selectedCompany">
              <option value="">请选择公司</option>
              <option v-for="company in status.companies" :key="company" :value="company">{{ company }}</option>
            </select>
          </label>
          <template v-if="selectedCompany">
            <p>可只建立可立即使用的基础仓库，也可同时创建寺院与房间示例结构。</p>
            <button class="primary" :disabled="setupBusy" @click="initialize(false)">{{ setupBusy ? '正在建立…' : '仅建立必需仓库' }}</button>
            <button :disabled="setupBusy" @click="initialize(true)">建立必需仓库和示例结构</button>
          </template>
        </template>
        <p v-else>请先安装 ERPNext 并在 ERPNext 中创建公司，然后重新检查。</p>
      </template>
      <p v-else>请联系系统管理员完成 ERPNext、公司和仓库设置。</p>
      <p><a href="/app/company" target="_blank">打开 ERPNext 公司</a> · <a href="/app/installed-applications" target="_blank">已安装应用</a></p>
      <button @click="check">重新检查</button>
      <p v-if="error" class="error">{{ error }}</p>
    </main>
    <template v-else>
      <section v-if="status?.warnings?.length" class="configuration-warning" role="alert">
        <p><b>库存设置需要注意：</b> {{ status.warnings.map((issue: any) => issue.message).join('；') }}</p>
        <button v-if="status.can_repair" class="primary" :disabled="repairBusy" @click="repair">{{ repairBusy ? '正在自动修复…' : '自动修复' }}</button>
        <p v-else>请联系系统管理员处理这些设置。</p>
        <p v-if="error" class="error">{{ error }}</p>
      </section>
      <RouterView :key="`${route.fullPath}-${contentKey}`" />
    </template>
    <div v-if="sessionExpired" class="modal auth-modal" role="alertdialog" aria-modal="true">
      <section><h2>请重新登录</h2><p>未保存的输入仍保留在此窗口。请在新窗口登录后返回继续保存。</p><a href="/login?redirect-to=%2Finventory%2Fauth-complete" target="_blank" rel="noopener">打开 Frappe 登录</a><button @click="resume">继续保存</button><p v-if="error" class="error">{{ error }}</p></section>
    </div>
    <div v-if="updateAvailable" class="pwa-update" role="alert"><span>发现新版本，保存完成后可以更新。</span><button class="primary" @click="applyUpdate">更新并重新加载</button></div>
  </FrappeUIProvider>
</template>
