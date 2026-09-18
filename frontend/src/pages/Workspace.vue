<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api, workspaceApi, upload, labels, warehouseLabel, roomFor, sessionExpired } from '../lib/api'
import { SaveQueue } from '../lib/autosave'
import Scanner from '../components/Scanner.vue'
import ItemPicker from '../components/ItemPicker.vue'
import SignaturePad from '../components/SignaturePad.vue'
const route=useRoute(),router=useRouter(), boot=ref<any>(), record=ref<any>(), form=ref<any>(), error=ref(''), saveStatus=ref('正在加载…'), dirty=ref(false), conflict=ref(false), saving=ref(false), confirming=ref(false)
const picker=ref(false), scanner=ref(false), unknown=ref(''), scanBusy=ref(false), recentScans=ref<string[]>([]), catalog=ref<Record<string,any>>({}), people=ref<any[]>([]), activities=ref<any[]>([]), review=ref(false), addingLocation=ref(false)
const currentRoom=ref(''), currentLocation=ref(''), currentTo=ref(''), chosen=ref<any>(), line=ref<any>(), editingIndex=ref(-1), batchRows=ref<any[]>([]), activityDialog=ref(false)
const activity=ref({title:'',activity_type:'Other',start_date:'',end_date:'',description:''}), activitySearch=ref('')
const activityTypeLabel=(t:string)=>({Distribution:'分发',Event:'活动',Performance:'演出','Religious Activity':'宗教活动',Maintenance:'维护',Other:'其他'} as any)[t]||t
const newRequestId=ref('')
let applying=false, editVersion=0, mounted=true
const readonly=computed(()=>!!record.value?.docstatus)
const tree=computed<any[]>(()=>boot.value?.warehouse_tree||[])
const allowed=computed<any[]>(()=>boot.value?.physical_warehouses||[])
const rooms=computed(()=>{const names=new Set(allowed.value.map(w=>roomFor(w.name,tree.value))); return [...names].map(name=>tree.value.find(w=>w.name===name)).filter(Boolean)})
const locations=computed(()=>allowed.value.filter(w=>!currentRoom.value||roomFor(w.name,tree.value)===currentRoom.value))
const isReceive=computed(()=>form.value?.movement_kind==='Receive')
const isTransfer=computed(()=>['Transfer','Loan','Return','Damage'].includes(form.value?.movement_kind))
const groups=computed(()=>{const result:Record<string,{room:string;location:string;lines:any[]}>={}; for(const section of form.value?.sections||[]) result[section.warehouse]={room:roomFor(section.warehouse,tree.value),location:section.warehouse,lines:[]}; for(const [index,row] of (form.value?.items||[]).entries()){const location=isReceive.value?row.warehouse:(row.from_warehouse||row.warehouse); result[location]||={room:roomFor(location,tree.value),location,lines:[]}; result[location]!.lines.push({...row,index})} return Object.values(result).sort((a,b)=>a.room.localeCompare(b.room)||a.location.localeCompare(b.location))})
const totals=computed(()=>{const t:Record<string,number>={}; for(const r of form.value?.items||[]) t[r.uom]=(t[r.uom]||0)+Number(r.qty||0);return t})
const label=(name:string)=>warehouseLabel(name,tree.value)
function changed(immediate=false) { if(applying||readonly.value)return; editVersion++; dirty.value=true; saveStatus.value='尚未保存'; queue.schedule(immediate) }
function invalidate() { if(form.value)form.value.signature='' }
watch(form,()=>changed(),{deep:true,flush:'sync'})
const queue=new SaveQueue(async()=>{
  if(!record.value||readonly.value)return
  saving.value=true;saveStatus.value='正在保存…';const version=editVersion
  try {
    const payload=JSON.parse(JSON.stringify(form.value))
    const result=record.value.name
      ? await workspaceApi('save_workspace',{name:record.value.name,revision:record.value.revision,data:payload})
      : await workspaceApi('create_workspace',{request_id:newRequestId.value,movement_kind:payload.movement_kind,data:payload})
    record.value=result
    if (route.path.startsWith('/new/')) await router.replace(`/workspace/${result.name}`)
    if(version===editVersion){applying=true;form.value=result.data;applying=false;dirty.value=false;saveStatus.value='✓ 已保存'}else saveStatus.value='尚未保存'
  }finally{saving.value=false}
},(e)=>{error.value=e.message;saveStatus.value='⚠ 尚未保存';if(e.kind==='TimestampMismatchError')conflict.value=true},()=>sessionExpired.value||conflict.value)
async function hydrate(){for(const row of form.value.items||[]){if(!catalog.value[row.item_code])try{catalog.value[row.item_code]=await workspaceApi('item_detail',{item_code:row.item_code})}catch(e:any){error.value=e.message}}}
async function load(){try{
  boot.value=await api('bootstrap');
  const results=await Promise.all([workspaceApi('responsible_people'),workspaceApi('activities')]);
  people.value=results[0];activities.value=results[1];
  let d:any
  if(route.params.name)d=await workspaceApi('load_workspace',{name:route.params.name})
  else if(route.params.entry)d=await workspaceApi('open_entry',{name:route.params.entry})
  else {
    const kind=String(route.params.kind||'Receive');
    let key=sessionStorage.getItem(`ti-new:${kind}`);
    if(!key){key=crypto.randomUUID();sessionStorage.setItem(`ti-new:${kind}`,key)}
    newRequestId.value=key
    const now=new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
    d={name:'',revision:0,stock_entry:null,docstatus:0,sync_error:'',attachments:[],data:{
      movement_kind:kind,posting_date:`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
      posting_time:`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      responsible_person:boot.value.user,source_type:'',donor_source:'',purpose:'',recipient:'',activity:'',
      loan_reference:'',notes:'',signature:'',items:[],sections:[],from_warehouse:'',to_warehouse:'',lease_program_warehouse:''
    }}
  }
  record.value=d;applying=true;form.value=d.data;applying=false;dirty.value=false;saveStatus.value='✓ 已保存';conflict.value=false;
  const physical=boot.value.physical_warehouses||boot.value.warehouses||[]
  currentLocation.value=physical[0]?.name||'';currentRoom.value=roomFor(currentLocation.value,tree.value);currentTo.value=boot.value.settings.default_lease_program_warehouse||'';
  await hydrate();
}catch(e:any){error.value=e.message;saveStatus.value='加载失败'}}
async function selectItem(item:any){catalog.value[item.item_code]=item;chosen.value=item;picker.value=false;unknown.value='';editingIndex.value=-1;line.value={id:crypto.randomUUID(),item_code:item.item_code,qty:1,uom:item.stock_uom,warehouse:currentLocation.value,from_warehouse:currentLocation.value,to_warehouse:form.value.movement_kind==='Loan'?boot.value.settings.default_lease_program_warehouse:form.value.movement_kind==='Damage'?boot.value.settings.damaged_warehouse:currentTo.value,batch_no:'',new_batch:false};await loadBatches()}
async function editLine(index:number){editingIndex.value=index;line.value=JSON.parse(JSON.stringify(form.value.items[index]));chosen.value=catalog.value[line.value.item_code]||await workspaceApi('item_detail',{item_code:line.value.item_code});await loadBatches()}
async function loadBatches(){if(!chosen.value?.has_batch_no)return;try{batchRows.value=await workspaceApi('batches',{item_code:chosen.value.item_code,warehouse:isReceive.value?undefined:line.value.from_warehouse||line.value.warehouse})}catch(e:any){error.value=e.message}}
async function scan(value:string){if(scanBusy.value||chosen.value)return;scanBusy.value=true;try{const d=await api('scan',{value});if(d.unknown){unknown.value=value;picker.value=true}else if(d.item_code){await selectItem(await workspaceApi('item_detail',{item_code:d.item_code}));if(d.batch_no)line.value.batch_no=d.batch_no}else if(d.warehouse){currentLocation.value=d.warehouse;currentRoom.value=roomFor(d.warehouse,tree.value)}}catch(e:any){error.value=e.message}finally{scanBusy.value=false}}
function addLine(){if(!line.value||!(Number(line.value.qty)>0))return;invalidate();const row={...line.value};if(!isReceive.value)row.warehouse=row.from_warehouse;currentLocation.value=isReceive.value?row.warehouse:row.from_warehouse;currentRoom.value=roomFor(currentLocation.value,tree.value);currentTo.value=row.to_warehouse;if(editingIndex.value>=0)form.value.items.splice(editingIndex.value,1,row);else form.value.items.push(row);recentScans.value.unshift(`${chosen.value.item_name} · ${row.qty} ${row.uom}`);chosen.value=undefined;line.value=undefined;changed(true)}
function removeLine(index:number){invalidate();form.value.items.splice(index,1);changed(true)}
function addSection(){if(!currentLocation.value)return;form.value.sections||=[];if(!form.value.sections.some((s:any)=>s.warehouse===currentLocation.value)){invalidate();form.value.sections.push({warehouse:currentLocation.value});changed(true)}addingLocation.value=false}
async function attach(event:Event){const input=event.target as HTMLInputElement;error.value='';try{await queue.flush();if(dirty.value)return;for(const file of Array.from(input.files||[]))await upload(file,'Inventory Workspace',record.value.name);record.value=await workspaceApi('load_workspace',{name:record.value.name});changed(true)}catch(e:any){error.value=e.message}finally{input.value=''}}
async function removeFile(name:string){try{record.value=await workspaceApi('remove_attachment',{name:record.value.name,file_name:name});changed(true)}catch(e:any){error.value=e.message}}
async function createActivity(){try{const d=await workspaceApi('create_activity',{data:activity.value});activities.value.unshift(d);invalidate();form.value.activity=d.name;activityDialog.value=false;changed(true)}catch(e:any){error.value=e.message}}
async function showReview(){error.value='';await queue.flush();if(dirty.value||conflict.value){error.value||='请先保存所有修改';return}review.value=true}
async function confirm(){if(confirming.value)return;confirming.value=true;error.value='';try{await queue.flush();if(dirty.value)throw new Error('请先保存所有修改');const d=await workspaceApi('confirm_workspace',{name:record.value.name,revision:record.value.revision});record.value=d;applying=true;form.value=d.data;applying=false;review.value=false;scanner.value=false;saveStatus.value='已完成 ✓'}catch(e:any){error.value=e.message}finally{confirming.value=false}}
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
watch(sessionExpired,v=>{if(v)scanner.value=false;else if(dirty.value)queue.schedule(true)})
async function deleteDraft(){if(!record.value?.name)return; if(!window.confirm('确定删除这条未完成记录吗？此操作无法撤销。'))return; try{await queue.flush();await workspaceApi('delete_draft',{name:record.value.name});await router.replace('/history?status=unfinished')}catch(e:any){error.value=e.message}}
onBeforeRouteLeave(async()=>{await queue.flush();if(dirty.value)return window.confirm('还有尚未保存的修改。确定离开？')})
onMounted(()=>{void load();window.addEventListener('beforeunload',beforeUnload)})
onBeforeUnmount(()=>{mounted=false;queue.dispose();window.removeEventListener('beforeunload',beforeUnload)})
</script>
<template>
<main class="app-shell workspace"><header><RouterLink to="/">‹ 首页</RouterLink><h1>{{labels[form?.movement_kind]||'库存记录'}}</h1><button v-if="!readonly && record?.name" @click="deleteDraft">删除草稿</button><span role="status">{{readonly ? (record.docstatus===1?'已完成 ✓':'已取消') : saveStatus}}</span></header>
<p v-if="error" class="error" role="alert">{{error}}</p><div v-if="conflict" class="error">记录已在其他窗口修改。当前输入仍保留在页面中，请复制需要保留的内容后重新打开记录。<button @click="load">重新加载</button></div><button v-else-if="dirty && !saving" @click="queue.schedule(true)">重试保存</button>
<template v-if="form && boot">
<fieldset :disabled="readonly || confirming"><div class="form-grid" @input="invalidate"><label>日期<input type="date" v-model="form.posting_date"></label><label>时间<input type="time" step="1" v-model="form.posting_time"></label>
<label v-if="isReceive">入库来源<select v-model="form.source_type"><option value="">请选择</option><option value="Donation">捐赠</option><option value="Purchase">采购</option><option value="Returned">退回</option><option value="Internal">内部（原有）</option><option value="Other">其他</option></select></label><label v-if="isReceive">捐赠人 / 来源<input v-model="form.donor_source"></label><label v-else>用途（可选）<input v-model="form.purpose" list="purposes"><datalist id="purposes"><option v-for="p in ['分发','活动/演出','内部使用','对外捐赠','损坏/报废','其他']">{{p}}</option></datalist></label><label v-if="!isReceive">领取对象 / 借用人<input v-model="form.recipient"></label>
<label>活动<button type="button" class="selector-button" @click="activityDialog=true">{{activities.find((a:any)=>a.name===form.activity)?.title||'选择活动（可选）'}}</button></label><label v-if="['Return','Damage','Loss'].includes(form.movement_kind)">原借出记录（可选）<input v-model="form.loan_reference" placeholder="Stock Entry 编号"></label></div></fieldset>
<div v-if="!readonly" class="location-bar"><label>当前房间<select v-model="currentRoom" @change="currentLocation=locations[0]?.name||''"><option v-for="r in rooms" :value="r.name">{{label(r.name)}}</option></select></label><label v-if="locations.length>1">当前位置<select v-model="currentLocation"><option v-for="w in locations" :value="w.name">{{label(w.name)}}</option></select></label><button v-if="form.items?.length" @click="currentLocation='';currentRoom=''">新增仓库/位置</button></div>
<section v-for="g in groups" :key="g.location" class="location-section"><h2>📍 {{label(g.room)}}</h2><h3>{{label(g.location)}}</h3><p v-if="!g.lines.length">尚未添加物品</p><article v-for="r in g.lines" :key="r.id" class="item-card"><img v-if="catalog[r.item_code]?.image" :src="catalog[r.item_code].image"><div><b>{{catalog[r.item_code]?.item_name||r.item_code}}</b><p>{{r.qty}} {{r.uom}} <small>{{r.item_code}}</small></p><p v-if="r.batch_no">批次 {{r.batch_no}}</p><p v-if="r.expiry_date">到期 {{r.expiry_date}}</p><p v-if="isTransfer">→ {{label(r.to_warehouse)}}</p></div><div v-if="!readonly"><button @click="editLine(r.index)">编辑</button><button @click="removeLine(r.index)">移除</button></div></article><button v-if="!readonly && !g.lines.length" @click="invalidate();form.sections=form.sections.filter((s:any)=>s.warehouse!==g.location);changed(true)">移除此分组</button></section>
<div v-if="!readonly" class="toolbar"><button @click="picker=true;unknown=''">＋添加物品</button><button @click="scanner=!scanner">▣ 连续扫码</button></div>
<Scanner v-if="scanner && !readonly" :paused="!!chosen||picker||scanBusy" @scan="scan" @close="scanner=false"/><ul v-if="scanner"><li v-for="text in recentScans.slice(0,5)">✓ {{text}}</li></ul>
<section class="attachments"><h2>附件 / 照片 · {{record.attachments?.length||0}}</h2><template v-if="!readonly"><label class="file-button">📷 拍照<input type="file" accept="image/*" capture="environment" @change="attach"></label><label class="file-button">📎 上传文件<input type="file" multiple @change="attach"></label></template><div class="attachment-grid"><article v-for="f in record.attachments" :key="f.name"><a :href="f.file_url" target="_blank" rel="noopener"><img v-if="/\.(png|jpe?g|webp|gif)$/i.test(f.file_name)" :src="f.file_url" class="thumb">{{f.file_name}}</a><button v-if="!readonly" @click="removeFile(f.name)">移除</button></article></div></section>
<fieldset :disabled="readonly||confirming" @input="invalidate"><label>备注<textarea v-model="form.notes"/></label><label>负责人<select v-model="form.responsible_person"><option v-for="p in people" :value="p.name">{{p.full_name||p.name}}</option></select></label></fieldset>
<SignaturePad v-model="form.signature" :disabled="readonly||confirming" @complete="changed(true)"/><button v-if="!readonly" class="primary confirm-button" :disabled="saving||confirming||conflict" @click="showReview">查看确认摘要</button><p v-if="record.stock_entry">库存记录：{{record.stock_entry}} <a v-if="boot.is_manager" :href="`/app/stock-entry/${encodeURIComponent(record.stock_entry)}`">管理员查看</a></p>
<ItemPicker v-if="picker" :boot="boot" :barcode="unknown" @select="selectItem" @close="picker=false;unknown=''"/>
<div v-if="chosen && line" class="drawer-backdrop"><aside class="drawer wide" role="dialog" aria-modal="true" aria-label="数量与位置"><h2>{{chosen.item_name}}</h2><p>{{chosen.item_code}} · 总库存 {{chosen.total_stock}} {{chosen.stock_uom}}</p><form @submit.prevent="addLine"><label>数量<input type="number" min="0.000001" step="any" v-model.number="line.qty" required></label><label>单位<select v-model="line.uom"><option :value="chosen.stock_uom">{{chosen.stock_uom}}</option><option v-for="u in chosen.uoms.filter((u:any)=>u.uom!==chosen.stock_uom)" :value="u.uom">{{u.uom}} ({{u.conversion_factor}} {{chosen.stock_uom}})</option></select></label>
<label v-if="isReceive">入库位置<select v-model="line.warehouse" required><option v-for="w in allowed" :value="w.name">{{label(w.name)}}</option></select></label><template v-else><h3>各位置库存</h3><button type="button" v-for="s in chosen.stock" @click="line.from_warehouse=s.warehouse;loadBatches()">{{label(s.warehouse)}} · {{s.actual_qty}} {{chosen.stock_uom}}</button><label>来源位置<select v-model="line.from_warehouse" required @change="loadBatches"><option v-for="w in allowed" :value="w.name">{{label(w.name)}}</option></select></label></template><label v-if="isTransfer">目标位置<select v-model="line.to_warehouse" required><option v-for="w in allowed" :value="w.name">{{label(w.name)}}</option></select></label>
<template v-if="chosen.has_batch_no"><label v-if="isReceive && boot.capabilities.Batch"><input type="checkbox" v-model="line.new_batch" @change="line.batch_no=''">创建新批次</label><template v-if="line.new_batch"><label>批次编号（留空自动生成）<input v-model="line.batch_no"></label><label>生产日期<input type="date" v-model="line.manufacturing_date"></label><label>到期日期<input type="date" v-model="line.expiry_date" :required="!!chosen.has_expiry_date"></label></template><label v-else>批次<select v-model="line.batch_no" required><option value="">请选择批次</option><option v-for="b in batchRows" :value="b.name">{{b.name}} · {{b.expiry_date||'无到期日期'}} {{b.qty!=null?`· 库存 ${b.qty}`:''}}</option></select></label></template><button class="primary">{{editingIndex>=0?'更新':'添加'}}</button><button type="button" @click="chosen=undefined;line=undefined">取消</button></form></aside></div>
<div v-if="activityDialog" class="modal"><section role="dialog" aria-modal="true"><h2>选择活动</h2><label>搜索活动<input v-model="activitySearch"></label><div v-for="a in activities.filter((a:any)=>!activitySearch||a.title.includes(activitySearch))" :key="a.name"><button type="button" @click="form.activity=a.name;activityDialog=false;changed(true)">{{a.title}}（{{activityTypeLabel(a.activity_type)}}）</button></div><form v-if="!readonly && boot.capabilities['Inventory Activity']" @submit.prevent="createActivity"><h3>新建活动</h3><label>名称<input v-model="activity.title" required></label><label>类型<select v-model="activity.activity_type"><option v-for="t in ['Distribution','Event','Performance','Religious Activity','Maintenance','Other']" :value="t">{{activityTypeLabel(t)}}</option></select></label><label>开始日期<input type="date" v-model="activity.start_date"></label><label>结束日期<input type="date" v-model="activity.end_date"></label><label>说明<textarea v-model="activity.description"/></label><button>创建并选择</button><button type="button" @click="activityDialog=false">取消</button></form></section></div>
<div v-if="review" class="modal"><section role="dialog" aria-modal="true"><h2>确认{{labels[form.movement_kind]}}</h2><p>{{form.posting_date}} {{form.posting_time}}</p><p>{{form.donor_source||form.recipient||''}} · {{form.purpose||''}}</p><p>{{form.items.length}} 行物品</p><p v-for="(qty,uom) in totals">{{qty}} {{uom}}</p><p v-for="g in groups">{{label(g.location)}} · {{g.lines.length}} 行</p><p>活动：{{form.activity||'无'}}</p><p>附件：{{record.attachments?.length||0}}</p><p>负责人：{{form.responsible_person}}</p><p>{{form.signature?'✓ 已签名':'尚未签名'}}</p><p v-if="error" class="error">{{error}}</p><button :disabled="confirming" @click="review=false">返回修改</button><button class="primary" :disabled="confirming||!form.signature||!form.items.length" @click="confirm">{{confirming?'正在确认…':`确认${labels[form.movement_kind]}`}}</button></section></div>
</template></main>
</template>
