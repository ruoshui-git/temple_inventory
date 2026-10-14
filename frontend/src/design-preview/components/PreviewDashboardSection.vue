<script setup lang="ts">
import PreviewUiButton from "./PreviewUiButton.vue";
import InventoryIcon from "../../components/InventoryIcon.vue";
import type { DashboardSectionState } from "../dashboardModel";
defineProps<{ title: string; section: DashboardSectionState }>();
const emit = defineEmits<{ retry: [] }>();
</script>
<template>
	<article
		class="browse-card"
		:class="{ 'has-failure': section.status === 'error' || section.status === 'retrying' }"
		:aria-busy="section.status === 'loading' || section.status === 'retrying'"
	>
		<slot name="heading" />
		<div
			v-if="section.status === 'error' || section.status === 'retrying'"
			class="dashboard-failure"
			role="alert"
		>
			<InventoryIcon name="warning" aria-hidden="true" />
			<div>
				<strong>更新失败</strong>
				<p>
					{{ title }}未能更新。{{
						section.hasResult ? "保留上次结果，请重试。" : "暂时无法加载，请重试。"
					}}
				</p>
			</div>
			<PreviewUiButton
				:disabled="section.status === 'retrying'"
				:aria-label="`重试${title}`"
				@click="emit('retry')"
				>{{ section.status === "retrying" ? "正在重试…" : "重试" }}</PreviewUiButton
			>
		</div>
		<p v-else-if="section.status === 'loading'" role="status">正在更新…</p>
		<slot name="controls" />
		<template v-if="section.hasResult">
			<p v-if="section.status !== 'ready'" class="dashboard-stale-label">
				上次结果 · 尚未更新
			</p>
			<div class="dashboard-result" :class="{ 'is-stale': section.status !== 'ready' }">
				<slot />
			</div>
		</template>
		<p v-else-if="section.status === 'loading'" role="status">正在加载…</p>
	</article>
</template>
