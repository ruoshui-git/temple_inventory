<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Scanner from '../components/Scanner.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import { api, request } from '../lib/api'
import { detectInstallPlatform, installInstructions, installPwa, isStandalone } from '../lib/pwa'

const router = useRouter()
const route = useRoute()
const manager = ref(false)
const query = ref('')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const unfinishedCount = ref(0)
const items = ref<any[]>([])
const installDialog = ref(false)

const page = computed(() => {
  const view = String(route.query.view || '')
  return view === 'stock' ? 'inventory' : view === 'attention' || view === 'scan' ? view : 'home'
})
const labels: Record<string, string> = {
  Receive: '入库', Issue: '出库 / 发放', Transfer: '转移',
  Loan: '借出', Return: '归还', Damage: '标记损坏',
  Loss: '记录遗失', Repair: '修复归库', Disposal: '正式报废',
}
const activeItems = computed(() => items.value.filter(item =>
  !query.value || `${item.item_code} ${item.item_name}`.toLowerCase().includes(query.value.toLowerCase())
))

async function logout() {
  await request('logout')
  location.href = '/login?redirect-to=%2Finventory'
}
async function load(attention = false) {
  loading.value = true
  error.value = ''
  try {
    items.value = await api('inventory', { search: query.value || undefined, needs_attention: attention })
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
async function boot() {
  try {
    const data = await api('bootstrap')
    manager.value = !!data.is_manager
    unfinishedCount.value = data.unfinished_count || 0
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}
function navigate(view = '') {
  void router.push({ path: '/', query: view ? { view } : {} })
}
function openMovement(kind: string) {
  void router.push('/new/' + kind)
}
async function lookup(code: string) {
  try {
    const result = await api('scan', { value: code })
    if (result.item_code) await router.push('/item/' + encodeURIComponent(result.item_code))
    else error.value = '未找到物品，请从入库工作区创建。'
  } catch (e: any) {
    error.value = e.message
  }
}
function camera() { navigate('scan') }
function stopCamera() {}
const installPlatform = computed(() => typeof navigator === 'undefined'
  ? 'other'
  : detectInstallPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints))
const installHelp = computed(() => installInstructions(installPlatform.value))
async function install() {
  if (!(await installPwa())) installDialog.value = true
}
watch(() => route.query.view, (view, previous) => {
  if (view === previous) return
  if (view === 'stock') void load(false)
  else if (view === 'attention') void load(true)
})
onMounted(boot)
</script>
<template>
  <main class="app-shell">
    <header><button @click="logout">退出登录</button><button class="brand" @click="navigate()">寺院库存</button><span v-if="notice" class="notice">{{ notice }}</span>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <section v-if="page === 'home'" class="hero">
      <p class="eyebrow">库存与资产管理</p>
      <h1>今天需要处理什么？</h1>
      <h2>库存操作</h2>
      <div class="quick-grid"><button v-for="kind in ['Receive', 'Issue', 'Transfer']" :key="kind"
          @click="openMovement(kind)">{{ labels[kind] }}</button></div>
      <h2>借用管理</h2>
      <div class="quick-grid"><button @click="openMovement('Loan')">借出</button><button
          @click="openMovement('Return')">归还</button><button @click="openMovement('Loss')">记录遗失</button></div><h2>损坏处理</h2><div class="quick-grid"><button @click="openMovement('Damage')">标记损坏</button><button @click="openMovement('Repair')">修复归库</button><button @click="openMovement('Disposal')">正式报废</button></div>
      <div class="home-links"><RouterLink class="selection-row" to="/history">库存记录</RouterLink><RouterLink class="selection-row" to="/history?status=unfinished">未完成记录 <b v-if="unfinishedCount">{{unfinishedCount}}</b></RouterLink><button @click="navigate('stock')">查看库存</button><button
          @click="navigate('attention')">待处理</button><button @click="camera()">扫码</button><button v-if="!isStandalone" @click="install">安装到手机</button><button v-if="manager" @click="router.push('/settings')">库存设置</button></div>
    </section>
    <section v-else-if="page === 'inventory' || page === 'attention'"><div class="page-title"><button @click="navigate()">‹ 返回</button><h1>{{ page === 'attention' ? '待处理' : '查看库存' }}</h1></div><input v-model="query" placeholder="搜索名称或库存编号" @keyup.enter="load(page === 'attention')"><button @click="load(page === 'attention')">搜索</button><LoadingIndicator v-if="loading" text="正在加载库存…" /><template v-else><article v-for="item in activeItems" :key="item.item_code" class="item-card" role="link" tabindex="0" @click="router.push('/item/' + encodeURIComponent(item.item_code))" @keyup.enter="router.push('/item/' + encodeURIComponent(item.item_code))"><img v-if="item.image" :src="item.image"><div><b>{{ item.item_code }} · {{ item.item_name }}</b><p>{{ item.item_group }} · 可用 {{ item.available_stock }} {{ item.stock_uom }}　总计 {{ item.total_stock }}</p><small v-if="item.on_loan_qty">借出 {{ item.on_loan_qty }}</small><small v-if="item.pending_qty || item.needs_attention" class="warn"> 待处理</small></div></article><p v-if="!activeItems.length" class="empty-state">{{ page === 'attention' ? '暂无待处理物品' : '暂无库存物品' }}</p></template></section>
        <section v-else-if="page === 'scan'">
      <div class="page-title"><button @click="stopCamera(); navigate()">‹ 返回</button>
        <h1>扫码</h1>
      </div><p class="empty-state">请将条码置于取景框内；若无法使用摄像头，可在扫描器中手动输入编码。</p><Scanner @scan="lookup" @close="navigate()"/>
    </section>
    <div v-if="installDialog" class="modal" role="dialog" aria-modal="true"><section><h2>安装物资管理</h2><p>{{ installHelp }}</p><button class="primary" @click="installDialog = false">知道了</button></section></div>
  </main>
</template>