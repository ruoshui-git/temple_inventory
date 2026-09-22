<script setup lang="ts">
defineProps<{ label: string; title?: string }>()
</script>
<template><button type="button" class="icon-button" :aria-label="label"><slot /><span class="icon-button-tooltip" role="tooltip">{{ title || label }}</span></button></template>
