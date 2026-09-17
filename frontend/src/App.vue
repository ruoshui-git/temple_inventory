<script setup lang="ts">
import { ref } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'
import { sessionExpired, refreshSession } from './lib/api'
const error=ref('')
async function resume(){try{await refreshSession();error.value=''}catch(e:any){error.value=e.message}}
</script>
<template><FrappeUIProvider><RouterView/><div v-if="sessionExpired" class="modal auth-modal" role="alertdialog" aria-modal="true"><section><h2>请重新登录</h2><p>未保存的输入仍保留在此窗口。请在新窗口登录后返回继续保存。</p><a href="/login?redirect-to=%2Finventory%2Fauth-complete" target="_blank" rel="noopener">打开 Frappe 登录</a><button @click="resume">继续保存</button><p v-if="error" class="error">{{error}}</p></section></div></FrappeUIProvider></template>
