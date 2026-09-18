<template>
  <div class="loading-indicator" role="status" aria-live="polite">
    <span class="loading-spinner" aria-hidden="true"></span>
    <span>{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '正在加载…' })

</script>
