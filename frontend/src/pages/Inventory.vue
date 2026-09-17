<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const api = async (method: string, args: Record<string, unknown> = {}) => {
  const response = await fetch(`/api/method/temple_inventory.inventory_api.${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': (window as any).csrf_token || '' },
    body: JSON.stringify(args),
  })
  const body = await response.json()
  if (!response.ok || body.exc) throw new Error(body._server_messages ? JSON.parse(body._server_messages)[0].message : body.message || '操作失败')
  return body.message
}

type Item = { item_code: string; item_name: string; stock_uom: string; image?: string; total_stock: number; available_stock: number; on_loan_qty: number; damaged_qty: number; pending_qty: number; needs_attention: boolean; warehouse_stock: Record<string, number> }
type Line = { item_code: string; qty: number; uom?: string; warehouse?: string }
const page = ref<'home' | 'inventory' | 'attention' | 'movement' | 'scan' | 'setup'>('home')
const movementKind = ref('Receive')
const items = ref<Item[]>([])
const warehouses = ref<any[]>([])
const groups = ref<any[]>([])
const settings = ref<any>({})
const query = ref('')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const lines = ref<Line[]>([])
const selectedCode = ref('')
const qty = ref(1)
const fromWarehouse = ref('')
const toWarehouse = ref('')
const responsible = ref('')
const recipient = ref('')
const purpose = ref('')
const donor = ref('')
const notes = ref('')
const signature = ref('')
const canvas = ref<HTMLCanvasElement>()
let drawing = false
let media: MediaStream | undefined
const video = ref<HTMLVideoElement>()
const scanResult = ref('')
const setupCompany = ref('')
const setupRoot = ref('寺院仓库')

const activeItems = computed(() => items.value.filter((item) => !query.value || `${item.item_code} ${item.item_name}`.toLowerCase().includes(query.value.toLowerCase())))
const leafWarehouses = computed(() => warehouses.value.filter((warehouse) => !warehouse.is_group))
const typeLabel: Record<string, string> = { Receive: '入库', Issue: '出库 / 发放', Transfer: '转移', Loan: '借出', Return: '归还', Damage: '损坏', Loss: '遗失' }

async function load(attention = false) {
  loading.value = true; error.value = ''
  try { items.value = await api('inventory', { search: query.value || undefined, needs_attention: attention }) } catch (err: any) { error.value = err.message } finally { loading.value = false }
}
async function boot() {
  try { const data = await api('bootstrap'); settings.value = data.settings; warehouses.value = data.warehouses; groups.value = data.item_groups; responsible.value = data.user; setupCompany.value = data.settings.company || ''; await load() } catch (err: any) { error.value = err.message }
}
function openMovement(kind: string) {
  movementKind.value = kind; lines.value = []; selectedCode.value = ''; qty.value = 1; signature.value = ''; recipient.value = ''; purpose.value = ''; donor.value = ''; notes.value = ''
  fromWarehouse.value = ''; toWarehouse.value = kind === 'Receive' ? settings.value.pending_warehouse || '' : ''; page.value = 'movement'
}
function addLine() {
  const item = items.value.find((row) => row.item_code === selectedCode.value)
  if (!item || qty.value <= 0) return
  const existing = lines.value.find((line) => line.item_code === item.item_code)
  if (existing) existing.qty += Number(qty.value); else lines.value.push({ item_code: item.item_code, qty: Number(qty.value), uom: item.stock_uom })
  selectedCode.value = ''; qty.value = 1
}
function canvasPoint(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.value!.width / rect.width), y: (event.clientY - rect.top) * (canvas.value!.height / rect.height) }
}
function begin(event: PointerEvent) { drawing = true; const ctx = canvas.value?.getContext('2d'); const point = canvasPoint(event); ctx?.beginPath(); ctx?.moveTo(point.x, point.y); (event.target as HTMLElement).setPointerCapture(event.pointerId) }
function draw(event: PointerEvent) { if (!drawing) return; const ctx = canvas.value?.getContext('2d'); const point = canvasPoint(event); ctx?.lineTo(point.x, point.y); ctx!.strokeStyle = '#172033'; ctx!.lineWidth = 3; ctx!.lineCap = 'round'; ctx?.stroke() }
function end() { if (drawing && canvas.value) signature.value = canvas.value.toDataURL('image/png'); drawing = false }
function clearSignature() { const ctx = canvas.value?.getContext('2d'); ctx?.clearRect(0, 0, canvas.value!.width, canvas.value!.height); signature.value = '' }
async function saveMovement(submit: boolean) {
  if (!lines.value.length) return error.value = '请至少添加一个物品'
  if (submit && !signature.value) return error.value = '提交前请签名'
  loading.value = true; error.value = ''
  try {
    const data = await api('save_movement', { data: JSON.stringify({ movement_kind: movementKind.value, items: lines.value, from_warehouse: fromWarehouse.value, to_warehouse: toWarehouse.value, responsible_person: responsible.value, recipient: recipient.value, purpose: purpose.value, donor_source: donor.value, notes: notes.value, signature: signature.value }), submit })
    notice.value = submit ? `已提交 ${data.name}` : `草稿已保存 ${data.name}`; page.value = 'home'; await load()
  } catch (err: any) { error.value = err.message } finally { loading.value = false }
}
async function lookup(code: string) {
  try { const result = await api('scan', { value: code }); scanResult.value = result.item_code || result.warehouse || ''; if (result.item_code) { selectedCode.value = result.item_code; page.value = 'movement' } } catch (err: any) { error.value = err.message }
}
async function initializeSetup() {
  loading.value = true; error.value = ''
  try { const data = await api('setup', { company: setupCompany.value, root_warehouse_name: setupRoot.value }); notice.value = `已建立 ${data.root_warehouse}`; await boot(); page.value = 'home' } catch (err: any) { error.value = err.message } finally { loading.value = false }
}
async function camera() {
  error.value = ''; scanResult.value = ''
  try {
    media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); await nextTick(); if (video.value) video.value.srcObject = media
    const Detector = (window as any).BarcodeDetector
    if (!Detector) { error.value = '此浏览器不支持自动识别。请使用相机扫描后手动输入编号，或使用硬件扫码枪。'; return }
    const detector = new Detector({ formats: ['qr_code', 'code_128', 'ean_13', 'upc_a'] })
    const read = async () => { if (!media || !video.value) return; const codes = await detector.detect(video.value); if (codes[0]?.rawValue) { stopCamera(); await lookup(codes[0].rawValue); return } requestAnimationFrame(read) }; requestAnimationFrame(read)
  } catch { error.value = '无法打开相机。请允许相机权限或使用手动输入。' }
}
function stopCamera() { media?.getTracks().forEach((track) => track.stop()); media = undefined }
onBeforeUnmount(stopCamera); onMounted(boot)
</script>

<template>
  <main class="app-shell">
    <header><button class="brand" @click="page = 'home'">寺院库存</button><span v-if="notice" class="notice">{{ notice }}</span></header>
    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="page === 'home'" class="hero">
      <p class="eyebrow">库存与资产管理</p><h1>今天需要处理什么？</h1>
      <div class="quick-grid"><button v-for="kind in ['Receive','Issue','Transfer','Loan','Return','Damage','Loss']" :key="kind" @click="openMovement(kind)">{{ typeLabel[kind] }}</button><button @click="page='scan'; camera()">扫码</button></div>
      <div class="home-links"><button @click="page='inventory'; load()">查看库存</button><button @click="page='attention'; load(true)">待处理</button><button @click="page='setup'">管理员设置</button></div>
    </section>

    <section v-else-if="page === 'inventory' || page === 'attention'">
      <div class="page-title"><button @click="page='home'">‹ 返回</button><h1>{{ page === 'attention' ? '待处理' : '查看库存' }}</h1></div>
      <input v-model="query" placeholder="搜索名称或库存编号" @keyup.enter="load(page === 'attention')"><button @click="load(page === 'attention')">搜索</button>
      <p v-if="loading">加载中…</p><article v-for="item in activeItems" :key="item.item_code" class="item-card" @click="selectedCode=item.item_code; openMovement('Transfer')">
        <img v-if="item.image" :src="item.image"><div><b>{{ item.item_code }} · {{ item.item_name }}</b><p>可用 {{ item.available_stock }} {{ item.stock_uom }}　总计 {{ item.total_stock }}</p><small v-if="item.on_loan_qty">借出 {{ item.on_loan_qty }}　</small><small v-if="item.pending_qty || item.needs_attention" class="warn">待处理</small></div>
      </article>
    </section>

    <section v-else-if="page === 'movement'">
      <div class="page-title"><button @click="page='home'">‹ 返回</button><h1>{{ typeLabel[movementKind] }}</h1></div>
      <label>从仓库<select v-model="fromWarehouse" :disabled="movementKind==='Receive'"><option value="">请选择</option><option v-for="warehouse in leafWarehouses" :key="warehouse.name" :value="warehouse.name">{{ warehouse.name }}</option></select></label>
      <label>到仓库<select v-model="toWarehouse" :disabled="movementKind==='Issue'||movementKind==='Loss'||movementKind==='Loan'||movementKind==='Damage'"><option value="">请选择</option><option v-for="warehouse in leafWarehouses" :key="warehouse.name" :value="warehouse.name">{{ warehouse.name }}</option></select></label>
      <div class="add-line"><select v-model="selectedCode"><option value="">选择物品</option><option v-for="item in items" :key="item.item_code" :value="item.item_code">{{ item.item_code }} · {{ item.item_name }}</option></select><input v-model.number="qty" type="number" min="0.01" step="any"><button @click="addLine">添加</button><button @click="page='scan'; camera()">扫码添加</button></div>
      <div v-for="(line,index) in lines" :key="line.item_code" class="line">{{ line.item_code }} × {{ line.qty }} <button @click="lines.splice(index,1)">移除</button></div>
      <label>负责人<input v-model="responsible" required></label><label v-if="movementKind==='Loan'||movementKind==='Return'">借用人<input v-model="recipient"></label><label>用途<input v-model="purpose"></label><label v-if="movementKind==='Receive'">来源 / 捐赠人<input v-model="donor"></label><label>备注<textarea v-model="notes" /></label>
      <div class="signature"><span>手写签名（提交时必填）</span><canvas ref="canvas" width="600" height="180" @pointerdown="begin" @pointermove="draw" @pointerup="end" @pointerleave="end"></canvas><button @click="clearSignature">清除签名</button></div>
      <div class="submit-row"><button @click="saveMovement(false)">保存草稿</button><button class="primary" :disabled="loading" @click="saveMovement(true)">签名并提交</button></div>
    </section>

    <section v-else-if="page === 'scan'"><div class="page-title"><button @click="stopCamera(); page='home'">‹ 返回</button><h1>扫码</h1></div><video ref="video" autoplay playsinline></video><p>{{ scanResult || '将条码或二维码置于取景框内' }}</p><input placeholder="手动输入库存编号或条码" @keyup.enter="lookup(($event.target as HTMLInputElement).value)"></section>

    <section v-else-if="page === 'setup'"><div class="page-title"><button @click="page='home'">‹ 返回</button><h1>管理员设置</h1></div><p>建立根仓库与系统仓库。之后可在 ERPNext Desk 增加房间、货架和类别。</p><label>公司<input v-model="setupCompany" placeholder="公司"></label><label>寺院根仓库名称<input v-model="setupRoot"></label><button class="primary setup-button" :disabled="loading" @click="initializeSetup">建立库存结构</button><p><a href="/app/temple-inventory-settings">打开高级设置</a></p></section>
  </main>
</template>
