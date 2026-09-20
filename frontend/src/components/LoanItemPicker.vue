<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, warehouseLabel } from '../lib/api'
const props=defineProps<{tree:any[]}>(); const emit=defineEmits<{select:[row:any];close:[]}>(); const rows=ref<any[]>([]); const total=ref(0); const busy=ref(false); const error=ref(''); const query=ref('')
let timer: ReturnType<typeof setTimeout>|undefined
async function load(append=false){busy.value=true;try{const d=await api('loan_items',{search:query.value||undefined,start:append?rows.value.length:0,page_length:25});rows.value=append?[...rows.value,...(d.results||[]).filter((row:any)=>!rows.value.some(old=>old.loan_item===row.loan_item))]:d.results||[];total.value=d.total||0}catch(e:any){error.value=e.message}finally{busy.value=false}}
watch(query,()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void load(),300)})
onMounted(load)
const label=(name:string)=>warehouseLabel(name,props.tree)
</script>
<template><div class="drawer-backdrop"><aside class="drawer wide" role="dialog" aria-modal="true"><h2>选择未归还借出明细</h2><input v-model="query" placeholder="搜索物品、借用方、活动或借出单"><p v-if="busy">正在加载…</p><p v-if="error" class="error">{{error}}</p><button v-for="row in rows" :key="row.loan_item" class="selection-row" @click="emit('select',row)"><b>{{row.item_code}} · {{row.outstanding}} {{row.uom}}</b><small>{{row.loan}} · {{row.borrower}} · {{row.activity||'无活动'}}</small><small>原位置：{{label(row.original_warehouse)}}；正常 {{row.returned}}，损坏 {{row.damaged}}，遗失 {{row.lost}}</small></button><p v-if="!busy&&!rows.length" class="empty-state">没有未结借出明细</p><button v-if="rows.length<total" :disabled="busy" @click="load(true)">加载更多</button><button @click="emit('close')">取消</button></aside></div></template>
