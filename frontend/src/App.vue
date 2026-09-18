<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from './lib/api'
import { FrappeUIProvider } from 'frappe-ui'
import { sessionExpired, refreshSession } from './lib/api'
import { applyUpdate, registerPwa, updateAvailable } from './lib/pwa'
const error=ref(''), ready=ref(false), checking=ref(true), issues=ref<any[]>([]), canRepair=ref(false), repairBusy=ref(false)
async function check(){checking.value=true;try{const d=await api('readiness');ready.value=!!d.ready;issues.value=d.issues||[];canRepair.value=!!d.can_repair}catch(e:any){ready.value=false;issues.value=[{message:e.message}]}finally{checking.value=false}}
async function repair(){repairBusy.value=true;try{await api('repair_readiness');await check()}catch(e:any){error.value=e.message}finally{repairBusy.value=false}}
async function resume(){try{await refreshSession();error.value='';await check()}catch(e:any){error.value=e.message}}
onMounted(() => { void check(); void registerPwa() })
</script>
<template><FrappeUIProvider><main v-if="checking" class="app-shell"><p>正在检查库存系统配置…</p></main><main v-else-if="!ready" class="app-shell"><header><h1>物资管理尚未就绪</h1></header><p>请完成以下配置后再使用库存功能：</p><ul><li v-for="issue in issues" :key="issue.code">{{issue.message}}</li></ul><button v-if="canRepair" class="primary" :disabled="repairBusy" @click="repair">{{repairBusy?'正在修复…':'自动修复'}}</button><p>如需手动配置，请打开：</p><p><a href="/app/warehouse/view/tree" target="_blank">ERPNext 仓库树</a> · <a href="/app/stock-settings" target="_blank">库存设置</a></p><button @click="check">重新检查</button><p v-if="error" class="error">{{error}}</p></main><RouterView v-else/><div v-if="sessionExpired" class="modal auth-modal" role="alertdialog" aria-modal="true"><section><h2>请重新登录</h2><p>未保存的输入仍保留在此窗口。请在新窗口登录后返回继续保存。</p><a href="/login?redirect-to=%2Finventory%2Fauth-complete" target="_blank" rel="noopener">打开 Frappe 登录</a><button @click="resume">继续保存</button><p v-if="error" class="error">{{error}}</p></section></div><div v-if="updateAvailable" class="pwa-update" role="alert"><span>发现新版本，保存完成后可以更新。</span><button class="primary" @click="applyUpdate">更新并重新加载</button></div></FrappeUIProvider></template>
