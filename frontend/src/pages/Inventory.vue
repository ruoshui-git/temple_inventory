<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Scanner from '../components/Scanner.vue'
import LoadingIndicator from '../components/LoadingIndicator.vue'
import { api, request } from '../lib/api'
import { detectInstallPlatform, installInstructions, installPwa, isStandalone } from '../lib/pwa'
const router = useRouter()
const route = useRoute()
const manager=ref(false), canWarehouse=ref(false)
async function logout(){await request('logout');location.href='/login?redirect-to=%2Finventory'}

type Item = { item_code: string; item_name: string; item_group: string; stock_uom: string; image?: string; total_stock: number; available_stock: number; on_loan_qty: number; pending_qty: number; needs_attention: boolean }
type Line = { item_code: string; qty: number; uom?: string; warehouse?: string; from_warehouse?: string; to_warehouse?: string }
const page = computed<string>(() => { const view = String(route.query.view || ''); return view === 'stock' ? 'inventory' : view === 'attention' || view === 'scan' || view === 'programs' ? view : 'home' })
const movementKind = ref('Receive'), items = ref<Item[]>([]), warehouses = ref<any[]>([]), groups = ref<any[]>([]), settings = ref<any>({}), programs = ref<any[]>([])
const query = ref(''), loading = ref(false), programsLoading = ref(false), error = ref(''), notice = ref(''), unfinishedCount = ref(0), lines = ref<Line[]>([]), selectedCode = ref(''), qty = ref(1), fromWarehouse = ref(''), toWarehouse = ref(''), leaseProgram = ref('')
const installDialog = ref(false), responsible = ref(''), recipient = ref(''), purpose = ref(''), donor = ref(''), notes = ref(''), signature = ref(''), programName = ref('')
const drawer = ref<'item' | 'warehouse' | 'new-item' | 'category' | 'uom' | 'settings' | ''>(''); const drawerTarget = ref<any>(null); const selectorQuery = ref(''); const selectorRows = ref<any[]>([]); const selectorTotal = ref(0); const drawerWidth = ref(480); const showNewItem = ref(false), newName = ref(''), newUom = ref('件'), newGroup = ref(''), newCode = ref(''), newImage = ref<File | undefined>(), newCategory = ref(''), newBarcode = ref(''), newBatchTracking = ref(false)
const canvas = ref<HTMLCanvasElement>(); const video = ref<HTMLVideoElement>(); let drawing = false; 
const leafWarehouses = computed(() => warehouses.value.filter(w => !w.is_group))
const selectableWarehouses = computed(() => leafWarehouses.value.filter(w => w.name !== settings.value.leased_warehouse))
const activeItems = computed(() => items.value.filter(i => !query.value || `${i.item_code} ${i.item_name}`.toLowerCase().includes(query.value.toLowerCase())))
const selectedItem = computed(() => items.value.find(i => i.item_code === selectedCode.value))
const labels: Record<string, string> = { Receive: '入库', Issue: '出库 / 发放', Transfer: '转移', Loan: '借出', Return: '归还' }
async function load(attention = false) { loading.value = true; error.value = ''; try { items.value = await api('inventory', { search: query.value || undefined, needs_attention: attention }) } catch (e: any) { error.value = e.message } finally { loading.value = false } }
async function boot() { try { const d = await api('bootstrap'); settings.value = {...d.settings,uoms:d.uoms,batch:d.batch}; manager.value=d.is_manager; unfinishedCount.value=d.unfinished_count||0;canWarehouse.value=d.capabilities.Warehouse; warehouses.value = d.warehouses; groups.value = d.item_groups; responsible.value = d.user; await load(); await loadPrograms() } catch (e: any) { error.value = e.message } }
async function loadPrograms() { programsLoading.value = true; try { programs.value = await api('lease_programs') } catch (e: any) { error.value = e.message } finally { programsLoading.value = false } }
function navigate(view = '') { void router.push({ path: '/', query: view ? { view } : {} }) }
function openMovement(kind: string) { void router.push(`/new/${kind}`) }
function addLine() { const item = selectedItem.value; if (!item || qty.value <= 0) return; const warehouse = movementKind.value === 'Receive' ? toWarehouse.value : fromWarehouse.value; const existing = lines.value.find(line => line.item_code === item.item_code && line.warehouse === warehouse); if (existing) existing.qty += Number(qty.value); else lines.value.push({ item_code: item.item_code, qty: Number(qty.value), uom: item.stock_uom, warehouse }); selectedCode.value = ''; qty.value = 1 }
function itemFor(line: Line) { return items.value.find(item => item.item_code === line.item_code) }
async function beginNewItem() { drawer.value = 'new-item'; showNewItem.value = true; newName.value = ''; newUom.value = '件'; newGroup.value = groups.value[0]?.name || ''; newImage.value = undefined; newBarcode.value = ''; newBatchTracking.value = false; try { newCode.value = await api('next_item_code') } catch (e: any) { error.value = e.message } }
async function createCategory() { if (!newCategory.value) return; try { const d = await api('create_item_group', { name: newCategory.value }); groups.value.push({ name: d.name, item_group_name: d.item_group_name }); newGroup.value = d.name; newCategory.value = '' } catch (e: any) { error.value = e.message } }
async function uploadImage(itemCode: string) { if (!newImage.value) return ''; const form = new FormData(); form.append('file', newImage.value); form.append('doctype', 'Item'); form.append('docname', itemCode); form.append('docfield', 'image'); const response = await fetch('/api/method/upload_file', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': (window as any).csrf_token || '' }, body: form }); const data = await response.json(); if (!response.ok || data.exc) throw new Error('图片上传失败'); return data.message.file_url as string }
async function createNewItem() { if (!newName.value || !newUom.value || !newGroup.value) return error.value = '请填写名称、单位和类别'; loading.value = true; try { const d = await api('create_item', { data: JSON.stringify({ item_name: newName.value, stock_uom: newUom.value, item_group: newGroup.value, item_code: newCode.value, barcode: newBarcode.value, has_batch_no: newBatchTracking.value }) }); const image = await uploadImage(d.item_code); if (image) { await api('set_item_image', { item_code: d.item_code, image }) } const local: Item = { item_code: d.item_code, item_name: newName.value, item_group: newGroup.value, stock_uom: newUom.value, image, total_stock: 0, available_stock: 0, on_loan_qty: 0, pending_qty: 0, needs_attention: true }; items.value.push(local); selectedCode.value = d.item_code; closeDrawer(); showNewItem.value = false; notice.value = `已新建 ${d.item_code}` } catch (e: any) { error.value = e.message } finally { loading.value = false } }
function point(e: PointerEvent) { const r = canvas.value!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.value!.width / r.width), y: (e.clientY - r.top) * (canvas.value!.height / r.height) } }
function begin(e: PointerEvent) { drawing = true; const c = canvas.value?.getContext('2d'), p = point(e); c?.beginPath(); c?.moveTo(p.x, p.y); (e.target as HTMLElement).setPointerCapture(e.pointerId) }
function draw(e: PointerEvent) { if (!drawing) return; const c = canvas.value?.getContext('2d'), p = point(e); c?.lineTo(p.x, p.y); if (c) { c.strokeStyle = '#172033'; c.lineWidth = 3; c.lineCap = 'round'; c.stroke() } }
function end() { if (drawing && canvas.value) signature.value = canvas.value.toDataURL('image/png'); drawing = false }
function clearSignature() { canvas.value?.getContext('2d')?.clearRect(0, 0, canvas.value!.width, canvas.value!.height); signature.value = '' }
async function saveMovement(submit: boolean) { if (!lines.value.length) return error.value = '请至少添加一个物品'; if (submit && !signature.value) return error.value = '提交前请签名'; loading.value = true; error.value = ''; try { const d = await api('save_movement', { data: JSON.stringify({ movement_kind: movementKind.value, items: lines.value, from_warehouse: fromWarehouse.value, to_warehouse: toWarehouse.value, lease_program_warehouse: leaseProgram.value, responsible_person: responsible.value, recipient: recipient.value, purpose: purpose.value, donor_source: donor.value, notes: notes.value, signature: signature.value }), submit }); notice.value = submit ? `已提交 ${d.name}` : `草稿已保存 ${d.name}`; navigate(); await load() } catch (e: any) { error.value = e.message } finally { loading.value = false } }
async function saveProgram() { if (!programName.value) return; try { await api('save_lease_program', { name: programName.value }); programName.value = ''; await loadPrograms(); await boot() } catch (e: any) { error.value = e.message } }
async function lookup(code: string) { try { const r = await api('scan', { value: code }); if (r.item_code) await router.push(`/item/${encodeURIComponent(r.item_code)}`); else error.value='未找到物品，请从入库工作区创建。' } catch(e:any){error.value=e.message} }
function camera(){navigate('scan')}
function stopCamera(){}
const installPlatform = computed(() => typeof navigator === 'undefined' ? 'other' : detectInstallPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints))
const installHelp = computed(() => installInstructions(installPlatform.value))
async function install() { if (!(await installPwa())) installDialog.value = true }


async function openDrawer(kind: any, target: any = null) { drawer.value = kind; drawerTarget.value = target; selectorQuery.value = ''; if (kind === 'item') await loadSelector('search_items'); if (kind === 'warehouse') await loadSelector('search_warehouses') }
async function loadSelector(method: string, start = 0) { try { const d = await api(method, { search: selectorQuery.value, start, page_length: 30 }); selectorRows.value = d.results; selectorTotal.value = d.total } catch (e: any) { error.value = e.message } }
function selectDrawer(row: any) { if (drawer.value === 'item') selectedCode.value = row.item_code; else if (drawerTarget.value) drawerTarget.value.warehouse = row.name; else if (movementKind.value === 'Receive') toWarehouse.value = row.name; else fromWarehouse.value = row.name; drawer.value = '' }
function closeDrawer() { drawer.value = ''; drawerTarget.value = null }
function resizeDrawer(e: PointerEvent) { const start = e.clientX, initial = drawerWidth.value; const move = (m: PointerEvent) => drawerWidth.value = Math.max(360, Math.min(760, initial + start - m.clientX)); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up) }
watch(() => route.query.view, (view, previous) => { if (view === previous) return; if (view === 'stock') void load(false); else if (view === 'attention') void load(true); else if (view === 'programs') void loadPrograms() })
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
          @click="openMovement('Return')">归还</button></div>
      <div class="home-links"><RouterLink class="selection-row" to="/history">库存记录</RouterLink><RouterLink class="selection-row" to="/history?status=unfinished">未完成记录 <b v-if="unfinishedCount">{{unfinishedCount}}</b></RouterLink><button @click="navigate('stock')">查看库存</button><button
          @click="navigate('attention')">待处理</button><button @click="camera()">扫码</button><button
          @click="navigate('programs')">借用项目</button><button v-if="!isStandalone" @click="install">安装到手机</button><button v-if="manager" @click="router.push('/settings')">库存设置</button></div>
    </section>
    <section v-else-if="page === 'inventory' || page === 'attention'"><div class="page-title"><button @click="navigate()">‹ 返回</button><h1>{{ page === 'attention' ? '待处理' : '查看库存' }}</h1></div><input v-model="query" placeholder="搜索名称或库存编号" @keyup.enter="load(page === 'attention')"><button @click="load(page === 'attention')">搜索</button><LoadingIndicator v-if="loading" text="正在加载库存…" /><template v-else><article v-for="item in activeItems" :key="item.item_code" class="item-card" role="link" tabindex="0" @click="router.push('/item/' + encodeURIComponent(item.item_code))" @keyup.enter="router.push('/item/' + encodeURIComponent(item.item_code))"><img v-if="item.image" :src="item.image"><div><b>{{ item.item_code }} · {{ item.item_name }}</b><p>{{ item.item_group }} · 可用 {{ item.available_stock }} {{ item.stock_uom }}　总计 {{ item.total_stock }}</p><small v-if="item.on_loan_qty">借出 {{ item.on_loan_qty }}</small><small v-if="item.pending_qty || item.needs_attention" class="warn"> 待处理</small></div></article><p v-if="!activeItems.length" class="empty-state">{{ page === 'attention' ? '暂无待处理物品' : '暂无库存物品' }}</p></template></section>
    <section v-else-if="page === 'movement'">
      <div class="page-title"><button @click="navigate()">‹ 返回</button>
        <h1>{{ labels[movementKind] }}</h1>
      </div><label v-if="movementKind !== 'Receive'">默认从仓库<button class="selector-button"
          @click="openDrawer('warehouse')">{{ fromWarehouse || '请选择' }}</button></label><label
        v-if="movementKind === 'Receive' || movementKind === 'Transfer' || movementKind === 'Return'">默认到仓库<button
          class="selector-button" @click="openDrawer('warehouse')">{{ toWarehouse || '请选择' }}</button></label><label
        v-if="movementKind === 'Loan'">借用项目<select v-model="leaseProgram">
          <option v-for="p in programs" :key="p.name" :value="p.name">{{ p.warehouse_name }}</option>
        </select></label>
      <div class="add-line"><button class="selector-button" @click="openDrawer('item')">{{ selectedItem ?
        `${selectedItem.item_code} · ${selectedItem.item_name}` : '选择物品'}}</button><input v-model.number="qty"
          type="number" min="0.01" step="any"><button @click="addLine">添加</button><button
          v-if="movementKind === 'Receive'" @click="beginNewItem">新建物品</button></div>
      <div v-if="selectedItem" class="selected-item"><img v-if="selectedItem.image"
          :src="selectedItem.image"><span>类别：{{ selectedItem.item_group }}</span></div>
      <div v-for="(line, index) in lines" :key="index" class="line"><b>{{ line.item_code }}</b> × <input
          v-model.number="line.qty" type="number" min="0.01"><label>{{ movementKind === 'Receive' ? '入库位置' : '出库位置' }}<button
            class="selector-button" @click="openDrawer('warehouse', line)">{{ line.warehouse ||
            '请选择'}}</button></label><small>类别：{{ itemFor(line)?.item_group }}</small><button
          @click="lines.splice(index, 1)">移除</button></div><label>负责人 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><input v-model="responsible" required></label><label
        v-if="movementKind === 'Loan' || movementKind === 'Return'">借用人<input v-model="recipient"></label><label>用途<input
          v-model="purpose"></label><label v-if="movementKind === 'Receive'">来源 / 捐赠人<input
          v-model="donor"></label><label>备注<textarea v-model="notes" /></label>
      <div class="signature"><span>手写签名 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span></span><canvas ref="canvas" width="600" height="180" @pointerdown="begin"
          @pointermove="draw" @pointerup="end" @pointerleave="end"></canvas><button
          @click="clearSignature">清除签名</button></div>
      <div class="submit-row"><button @click="saveMovement(false)">保存草稿</button><button class="primary"
          :disabled="loading" @click="saveMovement(true)">签名并提交</button></div>
    </section>
    <section v-else-if="page === 'programs'">
      <div class="page-title"><button @click="navigate()">‹ 返回</button>
        <h1>借用项目</h1>
      </div>
      <p>在此可创建借出物资相关的活动/项目。</p>
      <div v-if="canWarehouse" class="add-line"><input v-model="programName" placeholder="例如：2026 暑期舞蹈"><button
          @click="saveProgram">创建项目</button></div>
      <LoadingIndicator v-if="programsLoading" text="正在加载借用项目…" /><template v-else><div v-for="p in programs" :key="p.name" class="line">{{ p.warehouse_name }}</div><p v-if="!programs.length" class="empty-state">暂无借用项目</p></template>
    </section>
    <section v-else-if="page === 'scan'">
      <div class="page-title"><button @click="stopCamera(); navigate()">‹ 返回</button>
        <h1>扫码</h1>
      </div><p class="empty-state">请将条码置于取景框内；若无法使用摄像头，可在扫描器中手动输入编码。</p><Scanner @scan="lookup" @close="navigate()"/>
    </section>
    <div v-if="installDialog" class="modal" role="dialog" aria-modal="true"><section><h2>安装物资管理</h2><p>{{ installHelp }}</p><button class="primary" @click="installDialog = false">知道了</button></section></div>
    <div v-if="drawer" class="drawer-backdrop" @click.self="closeDrawer">
      <aside class="drawer" :style="{ width: drawerWidth + 'px' }">
        <div class="drawer-resize" @pointerdown="resizeDrawer"></div><button class="drawer-close"
          @click="closeDrawer">×</button>
        <section v-if="drawer === 'item' || drawer === 'warehouse'">
          <h2>{{ drawer === 'item' ? '选择物品' : '选择仓库' }}</h2><input v-model="selectorQuery" placeholder="搜索"
            @input="loadSelector(drawer === 'item' ? 'search_items' : 'search_warehouses')"><button
            @click="camera()">扫码</button><button v-for="row in selectorRows" :key="row.name" class="selection-row"
            @click="selectDrawer(row)">{{ drawer === 'item' ? `${row.item_code} ·
            ${row.item_name}` : row.warehouse_name}}</button>
          <p v-if="selectorTotal > selectorRows.length">请搜索以缩小结果（共 {{ selectorTotal }} 条）</p>
        </section>
        <section v-else-if="drawer === 'new-item'">
          <h2>新建物品</h2><label>自动编号（可修改）<input v-model="newCode"></label><label>名称<input
              v-model="newName"></label><label>基础单位 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><select v-model="newUom" required>
              <option v-for="u in (settings.uoms || [])" :key="u.name" :value="u.name">{{ u.uom_name }}</option>
            </select></label><button @click="drawer = 'uom'">新建单位</button><label>类别 <span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span><select v-model="newGroup" required>
              <option v-for="g in groups" :key="g.name" :value="g.name">{{ g.item_group_name }}</option>
            </select></label><button @click="drawer = 'category'">新建类别</button><label>条码<input v-model="newBarcode"
              placeholder="可手动输入或扫码" /></label><label>图片<input type="file" accept="image/*"
              @change="newImage = ($event.target as HTMLInputElement).files?.[0]"></label><label><input
              v-model="newBatchTracking" type="checkbox" :disabled="!settings.batch?.enabled"> 启用批次与有效期追踪</label>
          <p v-if="!settings.batch?.enabled" class="warn">{{ settings.batch?.error }} <a
              :href="settings.batch?.settings_url">打开设置</a></p><button class="primary"
            @click="createNewItem">创建并添加</button>
        </section>
        <section v-else-if="drawer === 'category'">
          <h2>新建类别</h2><input v-model="newCategory" placeholder="类别名称"><button class="primary"
            @click="createCategory(); drawer = 'new-item'">创建</button>
        </section>
        <section v-else-if="drawer === 'uom'">
          <h2>新建单位</h2><input v-model="newUom" placeholder="单位名称"><button class="primary"
            @click="api('create_uom', { uom_name: newUom }).then((u: any) => { settings.uoms.push(u); drawer = 'new-item' })">创建</button>
        </section>
      </aside>
    </div>
  </main>
</template>