<script setup lang="ts">
import { ref, watch } from "vue";
import PreviewUiButton from "./PreviewUiButton.vue";
const props = defineProps<{ total: number; limit?: number }>();
const emit = defineEmits<{ "update:limit": [value: number] }>();
const state = ref("ready");
watch(
	() => props.total,
	() => {
		if (props.limit !== undefined) emit("update:limit", 20);
	},
);
</script>
<template>
	<section>
		<details>
			<summary>预览结果状态</summary>
			<select v-model="state" aria-label="结果加载状态">
				<option value="ready">正常</option>
				<option value="loading">首次加载</option>
				<option value="empty">空结果</option>
				<option value="refresh">保留结果刷新</option>
				<option value="error">加载更多失败</option>
			</select>
		</details>
		<p v-if="state === 'loading'" role="status">正在加载结果…</p>
		<p v-else-if="state === 'empty'">没有匹配结果，请调整筛选。</p>
		<template v-else
			><p v-if="state === 'refresh'" role="status">
				正在刷新，当前结果保留
				<PreviewUiButton @click="state = 'ready'">完成刷新</PreviewUiButton>
			</p>
			<slot />
			<p v-if="state === 'error'" role="alert">
				加载更多失败，已加载内容和选择保留。<PreviewUiButton @click="state = 'ready'"
					>重试加载</PreviewUiButton
				>
			</p>
			<PreviewUiButton
				v-else-if="limit !== undefined && total > limit"
				@click="emit('update:limit', limit + 20)"
				>加载更多 · 已显示 {{ limit }} / {{ total }}</PreviewUiButton
			></template
		>
	</section>
</template>
