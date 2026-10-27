<script setup lang="ts">
import { siteDateTime } from "../lib/nativeTime";
import AsyncRegion from "./ui/AsyncRegion.vue";
import BrowseRefreshNotice from "./ui/BrowseRefreshNotice.vue";
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
				aria-hidden="true"
			>
				{{ section.status === "loading" ? "更新中…" : "" }}
			</span>
		</div>
		<BrowseRefreshNotice
			:show="section.status === 'error' || section.status === 'retrying'"
			:retry="() => emit('retry')"
		/>
		<p
			v-if="section.error && section.status !== 'error' && section.status !== 'retrying'"
			class="browse-note"
		>
			{{ section.error }}
		</p>
		<slot name="controls" />
		<AsyncRegion
			:loading="section.status === 'loading' || section.status === 'retrying'"
			:initialized="section.hasResult"
			:stale="section.hasResult && section.status !== 'ready'"
			:error="section.error"
			:label="`${title}数据刷新中…`"
		>
			<template #skeleton>
				<div
					class="dashboard-section-skeleton"
					:class="`dashboard-section-skeleton--${title}`"
				>
					<template v-if="title === '库存概览'">
						<div
							v-for="row in skeletonRows"
							:key="row"
							class="dashboard-skeleton-metric"
						>
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
						<div
							v-for="row in skeletonRows"
							:key="row"
							class="dashboard-skeleton-list"
						>
							<i></i><b></b>
						</div>
					</template>
				</div>
			</template>
			<div class="dashboard-result"><slot /></div>
		</AsyncRegion>
		<p v-if="snapshot && section.hasResult" class="browse-note">
			范围快照（站点时间） {{ siteDateTime(snapshot) }}
		</p>
	</article>
</template>
