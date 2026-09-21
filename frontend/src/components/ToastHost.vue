<script setup lang="ts">
import { dismissToast, pauseToast, resumeToast, toasts } from '../lib/toast'
</script>
<template><Teleport to="body"><section class="toast-host" aria-label="通知"><article v-for="item in toasts" :key="item.id" class="toast" :class="item.kind" :role="item.kind==='error'?'alert':'status'" tabindex="0" @mouseenter="pauseToast(item)" @mouseleave="resumeToast(item)" @focusin="pauseToast(item)" @focusout="resumeToast(item)"><span>{{item.message}}</span><button type="button" aria-label="关闭通知" @click="dismissToast(item.id)">×</button><i :style="{ animationDuration: `${item.duration}ms` }" aria-hidden="true"></i></article></section></Teleport></template>
