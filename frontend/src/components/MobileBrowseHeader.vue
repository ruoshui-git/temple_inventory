<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import InventoryIcon from "./InventoryIcon.vue";

const props = withDefaults(
	defineProps<{
		title: string;
		shortTitle?: string;
		compact?: boolean;
		destinationKey: string;
		initialToolsExpanded?: boolean;
	}>(),
	{ shortTitle: "", compact: false, initialToolsExpanded: false },
);

const expandedFor = ref(props.destinationKey);
const toolsExpanded = ref(props.initialToolsExpanded);
const toolsId = `browse-tools-${useId()}`;
const toolsRegion = ref<HTMLElement>();
const toolsToggle = ref<HTMLButtonElement>();
const heading = ref<HTMLElement>();
const titleActions = ref<HTMLElement>();
const preserveTitle = ref(false);
defineExpose({
	get heading() {
		return heading.value;
	},
});
const titleText = computed(() => props.title);
watch(
	() => props.compact,
	(compact) => {
		if (!compact) return;
		if (toolsRegion.value?.contains(document.activeElement)) toolsExpanded.value = true;
		if (titleActions.value?.contains(document.activeElement)) preserveTitle.value = true;
	},
);
watch(
	() => props.destinationKey,
	() => {
		expandedFor.value = props.destinationKey;
		toolsExpanded.value = props.initialToolsExpanded;
	},
);

async function toggleTools() {
	if (expandedFor.value !== props.destinationKey) {
		expandedFor.value = props.destinationKey;
		toolsExpanded.value = false;
	}
	const closing = toolsExpanded.value;
	toolsExpanded.value = !toolsExpanded.value;
	if (closing && toolsRegion.value?.contains(document.activeElement)) {
		await nextTick();
		toolsToggle.value?.focus({ preventScroll: true });
	}
}
function updateFocusedRegion(event: FocusEvent) {
	const target = event.target as Node | null;
	if (toolsRegion.value?.contains(target)) toolsExpanded.value = true;
	preserveTitle.value = Boolean(titleActions.value?.contains(target));
}
function clearFocusedRegion(event: FocusEvent) {
	const next = event.relatedTarget as Node | null;
	if (!titleActions.value?.contains(next)) preserveTitle.value = false;
}
</script>

<template>
	<header
		class="mobile-browse-header"
		:class="{ compact, 'preserve-title': preserveTitle }"
		@focusin="updateFocusedRegion"
		@focusout="clearFocusedRegion"
	>
		<div ref="titleActions" class="mobile-browse-title">
			<h1 ref="heading" tabindex="-1">{{ titleText }}</h1>
			<div
				class="mobile-browse-title-actions"
				:inert="(compact && !preserveTitle) || undefined"
			>
				<slot name="back" />
				<slot name="title-actions" />
			</div>
		</div>
		<div class="mobile-browse-tabs"><slot name="tabs" /></div>
		<div class="mobile-browse-primary">
			<strong class="mobile-browse-short-title" aria-hidden="true">{{
				shortTitle || title
			}}</strong>
			<slot name="search-actions" />
			<button
				v-if="compact && $slots.secondary"
				ref="toolsToggle"
				type="button"
				class="mobile-browse-tools-toggle"
				:title="toolsExpanded ? '收起工具' : '展开工具'"
				:aria-label="toolsExpanded ? '收起工具' : '展开工具'"
				:aria-expanded="toolsExpanded"
				:aria-controls="toolsId"
				@click="toggleTools"
			>
				<InventoryIcon class="mobile-browse-tools-chevron" name="chevron-down" />
			</button>
		</div>
		<div
			ref="toolsRegion"
			v-show="!compact || toolsExpanded"
			:id="toolsId"
			class="mobile-browse-secondary"
			:aria-hidden="compact && !toolsExpanded ? 'true' : undefined"
		>
			<slot name="secondary" />
		</div>
	</header>
</template>

<style scoped>
.mobile-browse-header {
	display: grid;
	gap: var(--ti-space-2);
	min-width: 0;
}
.mobile-browse-title,
.mobile-browse-primary {
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
	min-width: 0;
}
.mobile-browse-title h1 {
	flex: 1;
	min-width: 0;
	margin: 0;
	font-size: clamp(18px, 5vw, 23px);
	line-height: 1.25;
}
.mobile-browse-short-title {
	display: none;
	flex: 0 1 auto;
	max-width: 6em;
	overflow: hidden;
	font-size: var(--ti-font-small);
	text-overflow: ellipsis;
	white-space: nowrap;
}
.mobile-browse-title-actions {
	display: flex;
	align-items: center;
	gap: var(--ti-space-1);
}
.mobile-browse-primary :deep(.mobile-search-actions) {
	display: flex;
	flex: 1 1 auto;
	gap: var(--ti-space-1);
	min-width: 0;
}
.mobile-browse-primary :deep(.mobile-search-actions label),
.mobile-browse-primary :deep(.mobile-search-actions input[type="search"]) {
	flex: 1 1 auto;
	min-width: 0;
}
.mobile-browse-primary :deep(.mobile-search-actions > button),
.mobile-browse-primary :deep(.mobile-search-actions button) {
	flex: 0 0 auto;
}
.mobile-browse-primary :deep(.movement-search),
.mobile-browse-primary :deep(.loan-search),
.mobile-browse-primary :deep(.overview-mobile-search),
.mobile-browse-primary :deep(.pending-mobile-search),
.mobile-browse-primary :deep(.history-mobile-search),
.mobile-browse-primary :deep(.warehouse-search) {
	flex: 1 1 auto;
	width: auto;
	min-width: 0;
}
.mobile-browse-primary :deep(.browse-search-field) {
	box-sizing: border-box;
	min-height: var(--ti-density-control);
}
.mobile-browse-primary :deep(.overview-mobile-search),
.mobile-browse-primary :deep(.pending-mobile-search),
.mobile-browse-primary :deep(.history-mobile-search),
.mobile-browse-primary :deep(.warehouse-search) {
	min-height: var(--ti-density-control);
}
.mobile-browse-primary :deep(.mobile-filter-button),
.mobile-browse-primary :deep(.mobile-scan),
.mobile-browse-primary :deep(.mobile-filter) {
	min-height: var(--ti-density-control);
}
.mobile-browse-primary :deep(button) {
	min-width: var(--ti-density-control);
	min-height: var(--ti-density-control);
}
.mobile-browse-secondary {
	min-width: 0;
}
.mobile-browse-tools-toggle {
	display: none;
	align-items: center;
	justify-content: center;
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
	color: var(--ti-ink);
	transition:
		background-color var(--ti-motion-fast) ease,
		border-color var(--ti-motion-fast) ease;
}
.mobile-browse-tools-toggle[aria-expanded="true"] {
	border-color: var(--ti-border-strong);
	background: var(--ti-accent-soft);
}
.mobile-browse-tools-chevron {
	transition: transform var(--ti-motion-fast) ease;
}
.mobile-browse-tools-toggle[aria-expanded="true"] .mobile-browse-tools-chevron {
	transform: rotate(180deg);
}
@media (prefers-reduced-motion: reduce) {
	.mobile-browse-tools-toggle,
	.mobile-browse-tools-chevron {
		transition: none;
	}
}
.mobile-browse-tabs:empty {
	display: none;
}
.mobile-browse-header.compact {
	gap: var(--ti-space-1);
}
.mobile-browse-header.compact .mobile-browse-title {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
}
.mobile-browse-header.compact.preserve-title .mobile-browse-title {
	position: static;
	width: auto;
	height: auto;
	overflow: visible;
	clip: auto;
	white-space: normal;
}
.mobile-browse-header.compact .mobile-browse-tabs {
	order: -1;
}
.mobile-browse-header.compact .mobile-browse-short-title {
	display: block;
}
.mobile-browse-header.compact .mobile-browse-primary :deep(input[type="search"]) {
	min-width: 0;
	flex: 1 1 auto;
}
.mobile-browse-header.compact .mobile-browse-tools-toggle {
	display: inline-flex;
	flex: 0 0 40px;
	width: 40px;
	min-height: var(--ti-density-control);
	padding: 0;
}
@media (max-width: 1023px) {
	.mobile-browse-header :deep(button),
	.mobile-browse-header :deep(a),
	.mobile-browse-header :deep(input) {
		min-height: var(--ti-density-control);
	}
	.mobile-browse-header.compact .mobile-browse-tools-toggle {
		min-width: var(--ti-density-control);
		width: var(--ti-density-control);
		min-height: var(--ti-density-control);
		flex-basis: var(--ti-density-control);
	}
}
@media (min-width: 1024px) {
	.mobile-browse-header.compact .mobile-browse-title {
		position: static;
		width: auto;
		height: auto;
		overflow: visible;
		clip: auto;
		white-space: normal;
	}
	.mobile-browse-short-title,
	.mobile-browse-tools-toggle {
		display: none !important;
	}
	.mobile-browse-header.compact .mobile-browse-tabs {
		order: initial;
	}
}
</style>
