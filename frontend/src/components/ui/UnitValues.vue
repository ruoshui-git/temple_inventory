<script setup lang="ts">
import { computed } from "vue";
import DetailPopover from "./DetailPopover.vue";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { sortByUnit } from "../../lib/units";

const props = withDefaults(
	defineProps<{
		entries: { uom: string; qty: number; tone?: string; title?: string }[];
		signed?: boolean;
		label: string;
		title?: string;
		max?: number;
		class?: string;
	}>(),
	{ signed: false, max: 2 },
);
const ordered = computed(() => sortByUnit(props.entries, (entry) => entry.uom));
function text(entry: (typeof ordered.value)[number]) {
	const qty = Number(entry.qty || 0);
	const sign = props.signed ? (qty > 0 ? "+" : qty < 0 ? "−" : "") : qty < 0 ? "−" : "";
	return `${sign}${formatQuantityWithUnit(Math.abs(qty), entry.uom)}`;
}
const fullText = computed(() => ordered.value.map(text).join("；"));
</script>

<template>
	<div
		:class="['unit-values', props.class]"
		role="group"
		:aria-label="`${label}：${fullText}`"
		:title="title || fullText"
	>
		<span
			v-for="entry in ordered.slice(0, max)"
			:key="entry.uom"
			:class="entry.tone"
			:title="entry.title"
			>{{ text(entry) }}</span
		>
		<!-- The disclosure must not trigger a surrounding record link. -->
		<span v-if="ordered.length > max" class="unit-values-more" @click.stop.prevent>
			<DetailPopover :label="`${label}：${fullText}`" trigger-class="operation-unit-more">
				<template #trigger>+{{ ordered.length - max }} 单位</template>
				<ul>
					<li v-for="entry in ordered" :key="entry.uom">{{ text(entry) }}</li>
				</ul>
			</DetailPopover>
		</span>
	</div>
</template>

<style scoped>
.unit-values {
	display: inline-flex;
	max-width: 100%;
	min-width: 0;
	align-items: center;
	gap: 0 var(--p-space-2);
	white-space: nowrap;
}
.unit-values > span {
	flex: 0 0 auto;
}
</style>
