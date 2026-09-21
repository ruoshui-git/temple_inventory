<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import ItemImagePreview from '../components/ItemImagePreview.vue'
import FloatingActionMenu from '../components/FloatingActionMenu.vue'
const rows=ref<any[]>([]), search=ref(''), busy=ref(false), loadingMore=ref(false), error=ref(''), total=ref(0)
const router = useRouter()
let timer: ReturnType<typeof setTimeout>|undefined
async function load(append=false){append?loadingMore.value=true:busy.value=true;error.value='';try{const d=await api('loans',{search:search.value||undefined,start:append?rows.value.length:0,page_length:25});const incoming=d.results||[];rows.value=append?[...rows.value,...incoming.filter((row:any)=>!rows.value.some(old=>old.name===row.name))]:incoming;total.value=Number(d.total||0)}catch(e:any){error.value=e.message}finally{busy.value=false;loadingMore.value=false}}
watch(search,()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void load(),300)})
onMounted(load)
</script>
<template><section class="app-shell wide-shell"><header><h1>借用</h1></header><input v-model="search" type="search" placeholder="搜索借用方、活动或物品" aria-label="搜索借用记录"><p aria-live="polite">{{busy?'正在加载…':`${total} 条未结借用`}}</p><p v-if="error" class="error">{{error}} <button type="button" @click="load()">重试</button></p><RouterLink v-for="loan in rows" :key="loan.name" class="loan-card selection-row" :to="`/loans/${encodeURIComponent(loan.name)}`"><b>{{loan.borrower||'借用记录'}} · {{loan.outstanding_lines}} 项未结</b><small>{{loan.loan_date}} · {{loan.activity||'无活动'}}</small><span v-for="item in loan.items.slice(0,3)" :key="item.loan_item"><ItemImagePreview :src="item.image" :alt="item.item_name"/> {{item.item_name}} {{item.outstanding}} {{item.uom}}</span></RouterLink><p v-if="!busy&&!rows.length" class="empty-state">没有未结借用记录</p><button v-if="rows.length<total" type="button" :disabled="loadingMore" @click="load(true)">{{loadingMore?'正在加载…':'加载更多'}}</button><FloatingActionMenu :actions="[{ kind: 'Loan', label: '新建借出' }]" @select="() => router.push('/new/Loan')" /></section></template>
