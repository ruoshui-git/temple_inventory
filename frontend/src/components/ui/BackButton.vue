<script setup lang="ts">
import UiButton from "./UiButton.vue";
withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), { label: "返回", disabled: false });
const emit = defineEmits<{ click: [] }>();
</script>

<template>
	<UiButton class="back-button" variant="ghost" icon="chevron-left" :disabled="disabled" @click="emit('click')">{{ label }}</UiButton>
</template>
