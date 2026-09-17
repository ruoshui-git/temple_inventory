<script setup lang="ts">
import {ref,onMounted,computed} from 'vue'
import {useRoute} from 'vue-router'
import {api,workspaceApi,warehouseLabel,labels} from '../lib/api'
const route=useRoute(),item=ref<any>(),boot=ref<any>(),error=ref('')
const consolidated=computed(()=> (boot.value?.warehouse_tree||[]).filter((w:any)=>w.is_group).map((w:any)=>({...w,qty:(item.value?.stock||[]).reduce((sum:number,s:any)=>{const leaf=boot.value.warehouse_tree.find((x:any)=>x.name===s.warehouse);return sum+(leaf&&leaf.lft>=w.lft&&leaf.rgt<=w.rgt?s.actual_qty:0)},0)})))
onMounted(async()=>{try{[boot.value,item.value]=await Promise.all([api('bootstrap'),workspaceApi('item_detail',{item_code:route.params.code})])}catch(e:any){error.value=e.message}})
</script>
<template><main class="app-shell"><header><RouterLink to="/">‹ 首页</RouterLink><h1>物品详情</h1></header><p v-if="error" class="error">{{error}}</p><template v-if="item"><img v-if="item.image" :src="item.image" class="detail-photo"><h2>{{item.item_name}}</h2><p>{{item.item_code}} · {{item.item_group}}</p><p>总库存 {{item.total_stock}} {{item.stock_uom}} · 可用 {{item.available_stock}}</p><h2>各位置库存</h2><div v-for="s in item.stock" class="selection-row">{{warehouseLabel(s.warehouse,boot.warehouse_tree)}} <b>{{s.actual_qty}} {{item.stock_uom}}</b></div><details><summary>房间及上级仓库汇总</summary><p v-for="r in consolidated">{{r.warehouse_name}} · {{r.qty}} {{item.stock_uom}}</p></details><h2>最近库存变动</h2><RouterLink v-for="r in item.history" class="selection-row" :to="r.legacy?`/entry/${encodeURIComponent(r.name)}`:`/workspace/${r.name}`">{{r.posting_date}} · {{labels[r.movement_kind]}} · {{['编辑中','已完成','已取消'][r.docstatus]}}</RouterLink></template></main></template>
