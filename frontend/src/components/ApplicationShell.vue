<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, request } from '../lib/api'
const route = useRoute(), router = useRouter()
const boot = ref<any>()
const destinations = [{ label: '库存', path: '/' }, { label: '借用', path: '/loans' }, { label: '仓库', path: '/warehouses' }, { label: '更多', path: '/more' }]
const active = computed(() => route.path.startsWith('/loans') ? '/loans' : route.path.startsWith('/warehouses') || route.path === '/settings' ? '/warehouses' : route.path.startsWith('/more') || route.path === '/history' ? '/more' : '/')
const pending = computed(() => Number(boot.value?.pending_count || 0))
async function logout() { await request('logout'); window.location.href = '/login?redirect-to=%2Finventory' }
onMounted(async () => { try { boot.value = await api('bootstrap') } catch { /* page-level API will render the error */ } })
</script>
<template>
  <div class="application-shell">
    <header class="desktop-nav"><RouterLink class="shell-brand" to="/">寺院库存</RouterLink><nav aria-label="主导航"><RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="active === item.path ? 'page' : undefined">{{ item.label }}</RouterLink></nav><div class="shell-actions"><RouterLink v-if="pending" class="pending-notice" to="/pending" :aria-label="`待处理 ${pending} 项`">待处理 <b>{{ pending }}</b></RouterLink><button type="button" @click="logout">退出登录</button></div></header>
    <main class="shell-content"><slot /></main>
    <nav class="mobile-nav" aria-label="主导航"><RouterLink v-for="item in destinations" :key="item.path" :to="item.path" :aria-current="active === item.path ? 'page' : undefined">{{ item.label }}</RouterLink></nav>
  </div>
</template>
