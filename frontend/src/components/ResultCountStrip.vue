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
	gap: 12px;
	min-height: 32px;
	padding: 5px 0;
	color: #6b6257;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
}
.result-count-strip__updating {
	color: #805022;
	font-weight: 650;
}
</style>
