<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../lib/api'
import ItemImagePreview from '../components/ItemImagePreview.vue'
const route=useRoute(),router=useRouter(),loan=ref<any>(),selected=ref<string[]>([]),error=ref('')
onMounted(async()=>{try{loan.value=await api('loan_detail',{name:route.params.name})}catch(e:any){error.value=e.message}})
function begin(kind:string){const items=(loan.value?.items||[]).filter((row:any)=>selected.value.includes(row.loan_item));if(!items.length)return;sessionStorage.setItem(`ti-seed:${kind}`,JSON.stringify({loan:loan.value.name,items}));void router.push(`/new/${kind}`)}
</script>
<template><section class="app-shell"><header><button @click="router.back()">‹ 返回</button><h1>借用详情</h1></header><p v-if="error" class="error">{{error}}</p><template v-if="loan"><h2>{{loan.borrower||'借用方未登记'}}</h2><p>{{loan.posting_datetime}} · {{loan.activity||'无活动'}}</p><article v-for="row in loan.items" :key="row.loan_item" class="item-card"><label><input v-model="selected" type="checkbox" :value="row.loan_item" :aria-label="`选择 ${row.item_name}`"></label><ItemImagePreview :src="row.image" :alt="row.item_name"/><div><b>{{row.item_name}}</b><p>借出 {{row.loaned}} · 已归还 {{row.returned}} · 损坏 {{row.damaged}} · 遗失 {{row.lost}}</p><p>尚未结清 {{row.outstanding}} {{row.uom}}</p></div></article><div v-if="selected.length" class="context-action-bar"><span>已选 {{selected.length}} 项</span><button @click="begin('Return')">归还</button><button @click="begin('Loss')">记录遗失</button></div></template></section></template>
