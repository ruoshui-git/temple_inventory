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
	z-index: 2;
	bottom: 8px;
	right: 8px;
	left: 8px;
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 40px;
	box-sizing: border-box;
	padding: 9px 12px;
	border: 1px solid #bfd0e4;
	border-radius: 10px;
	background: rgb(235 243 252 / 96%);
	box-shadow: 0 4px 14px rgb(32 64 99 / 14%);
	color: #273f59;
	font-size: 14px;
	font-weight: 650;
	pointer-events: none;
}
.section-update button {
	margin-left: auto;
	border: 0;
	background: transparent;
	color: #0c55a0;
	font: inherit;
	font-weight: 700;
	cursor: pointer;
	pointer-events: auto;
}
.dashboard-section a[aria-disabled="true"] {
	cursor: not-allowed;
}
</style>
