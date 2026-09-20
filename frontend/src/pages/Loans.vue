<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../lib/api'
import ItemImagePreview from '../components/ItemImagePreview.vue'
const rows=ref<any[]>([]), search=ref(''), busy=ref(false), error=ref(''), total=ref(0)
let timer: ReturnType<typeof setTimeout>|undefined
async function load(){busy.value=true;error.value='';try{const d=await api('loans',{search:search.value||undefined,page_length:25});rows.value=d.results||[];total.value=d.total||0}catch(e:any){error.value=e.message}finally{busy.value=false}}
watch(search,()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void load(),300)})
onMounted(load)
</script>
<template><section class="app-shell wide-shell"><header><h1>借用</h1><RouterLink class="primary-link" to="/new/Loan">新建借出</RouterLink></header><input v-model="search" type="search" placeholder="搜索借用方、活动或物品" aria-label="搜索借用记录"><p aria-live="polite">{{busy?'正在加载…':`${total} 条未结借用`}}</p><p v-if="error" class="error">{{error}}</p><RouterLink v-for="loan in rows" :key="loan.name" class="loan-card selection-row" :to="`/loans/${encodeURIComponent(loan.name)}`"><b>{{loan.borrower||'借用记录'}} · {{loan.outstanding_lines}} 项未结</b><small>{{loan.loan_date}} · {{loan.activity||'无活动'}}</small><span v-for="item in loan.items.slice(0,3)" :key="item.loan_item"><ItemImagePreview :src="item.image" :alt="item.item_name"/> {{item.item_name}} {{item.outstanding}} {{item.uom}}</span></RouterLink><p v-if="!busy&&!rows.length" class="empty-state">没有未结借用记录</p></section></template>
