<script setup lang="ts">
import type { DashboardController, DashboardSection } from "./useDashboardController";
import UiLoadingBoundary from "../../components/UiLoadingBoundary.vue";
import { ref } from "vue";

const props = defineProps<{
	controller: DashboardController;
	section: DashboardSection;
}>();
const busy = () => props.controller.sectionBusy(props.section);
const error = () => props.controller.sectionError(props.section);
const stale = () => props.controller.sectionStale(props.section);
const sectionElement = ref<HTMLElement>();
</script>

<template>
	<section
		ref="sectionElement"
		class="dashboard-section"
		:class="[
			section === 'loans' ? 'loan-section' : `${section}-section`,
			{ 'is-stale': stale() },
		]"
		:aria-busy="busy()"
	>
		<div v-if="error()" class="section-update" role="status">
			<span>更新失败，显示上次成功数据：{{ error() }}</span>
			<button v-if="error()" type="button" @click="controller.retrySection(section)">
				重试
			</button>
		</div>
		<UiLoadingBoundary
			:busy="busy() && !controller.globalLoading?.value"
			:region="sectionElement"
			:block-interactions="false"
			message="正在更新…"
		>
			<slot />
		</UiLoadingBoundary>
	</section>
</template>

<style scoped>
.section-update {
	position: absolute;
	z-index: var(--ti-layer-context);
	bottom: 8px;
	right: 8px;
	left: 8px;
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
	min-height: 40px;
	box-sizing: border-box;
	padding: var(--ti-space-2) var(--ti-space-3);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-small);
	background: color-mix(in srgb, var(--ti-info-bg) 96%, transparent);
	box-shadow: var(--ti-shadow-card);
	color: var(--ti-ink);
	font-size: var(--ti-font-body);
	font-weight: 650;
	pointer-events: none;
}
.section-update button {
	margin-left: auto;
	border: 0;
	background: transparent;
	color: var(--ti-info);
	font: inherit;
	font-weight: 700;
	cursor: pointer;
	pointer-events: auto;
}
.dashboard-section a[aria-disabled="true"] {
	cursor: not-allowed;
}
</style>
