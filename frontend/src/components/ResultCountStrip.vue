<script setup lang="ts">
withDefaults(
	defineProps<{
		loaded: number;
		filtered: number;
		overall: number;
		updating?: boolean;
	}>(),
	{ updating: false },
);
</script>

<template>
	<div
		class="result-count-strip"
		role="status"
		:aria-busy="updating || undefined"
		aria-live="polite"
	>
		<span>已加载 {{ loaded }} · 筛选结果 {{ filtered }} · 全部 {{ overall }}</span>
		<span v-if="updating" class="result-count-strip__updating">正在更新…</span>
	</div>
</template>

<style scoped>
.result-count-strip {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--ti-space-3);
	min-height: 32px;
	padding: var(--ti-space-1) 0;
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
	font-variant-numeric: tabular-nums;
}
.result-count-strip__updating {
	color: var(--ti-accent);
	font-weight: 650;
}
</style>
