<script setup lang="ts">
import { siteDateTime } from "../lib/nativeTime";
import UiButton from "./ui/UiButton.vue";
import InventoryIcon from "./InventoryIcon.vue";
interface DashboardSectionState {
	status: "ready" | "loading" | "error" | "retrying";
	hasResult: boolean;
	error?: string;
}
defineProps<{ title: string; section: DashboardSectionState; snapshot?: string }>();
const emit = defineEmits<{ retry: [] }>();
const skeletonRows = [1, 2, 3, 4];
</script>
<template>
	<article
		class="browse-card"
		:class="{ 'has-failure': section.status === 'error' || section.status === 'retrying' }"
		:aria-busy="section.status === 'loading' || section.status === 'retrying'"
	>
		<div class="dashboard-section-heading">
			<slot name="heading" />
			<span
				class="dashboard-refresh-status"
				:class="{ 'is-active': section.status === 'loading' }"
				:aria-hidden="section.status === 'loading' ? undefined : 'true'"
				:aria-label="
					section.status === 'loading'
						? `${section.hasResult ? '正在更新' : '正在加载'}${title}…`
						: undefined
				"
				role="status"
			>
				{{ section.status === "loading" ? "更新中…" : "" }}
			</span>
		</div>
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
			<UiButton
				:disabled="section.status === 'retrying'"
				:aria-label="`重试${title}`"
				@click="emit('retry')"
				>{{ section.status === "retrying" ? "正在重试…" : "重试" }}</UiButton
			>
		</div>
		<p v-if="section.error" class="browse-note">{{ section.error }}</p>
		<slot name="controls" />
		<template v-if="section.hasResult">
			<div class="dashboard-result" :class="{ 'is-stale': section.status !== 'ready' }">
				<slot />
			</div>
		</template>
		<div
			v-else-if="section.status === 'loading'"
			class="dashboard-section-skeleton"
			:class="`dashboard-section-skeleton--${title}`"
			aria-hidden="true"
		>
			<template v-if="title === '库存概览'">
				<div v-for="row in skeletonRows" :key="row" class="dashboard-skeleton-metric">
					<i></i><b></b><span></span>
				</div>
			</template>
			<template v-else-if="title === '库存分布'">
				<div v-for="row in skeletonRows" :key="row" class="dashboard-skeleton-bar">
					<i></i><span><b></b></span><em></em>
				</div>
			</template>
			<template v-else-if="title === '效期概览'">
				<div v-for="row in 6" :key="row" class="dashboard-skeleton-tile">
					<i></i><b></b>
				</div>
				<div v-for="row in 3" :key="`row-${row}`" class="dashboard-skeleton-list">
					<i></i><b></b>
				</div>
			</template>
			<template v-else>
				<div v-for="row in skeletonRows" :key="row" class="dashboard-skeleton-list">
					<i></i><b></b>
				</div>
			</template>
		</div>
		<p v-if="snapshot && section.hasResult" class="browse-note">
			范围快照（站点时间） {{ siteDateTime(snapshot) }}
		</p>
	</article>
</template>
