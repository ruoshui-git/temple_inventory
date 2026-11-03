<script lang="ts">
export type GroupTotalMetric = {
	key: string;
	label: string;
	entries: { uom: string; qty: number }[];
	signed?: boolean;
};
</script>

<script setup lang="ts">
import { computed } from "vue";
import DetailPopover from "./DetailPopover.vue";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
import { sortByUnit } from "../../lib/units";

const props = withDefaults(
	defineProps<{
		metrics: GroupTotalMetric[];
		max?: number;
		label?: string;
	}>(),
	{ max: 2, label: "分组数量" },
);

function quantityText(metric: GroupTotalMetric, qty: number, uom: string) {
	const sign = metric.signed ? (qty > 0 ? "+" : qty < 0 ? "−" : "") : qty < 0 ? "−" : "";
	return `${sign}${formatQuantityWithUnit(Math.abs(qty), uom)}`;
}

// One row per metric with every unit, in unit order; metrics without entries drop out.
const rows = computed(() =>
	props.metrics
		.filter((metric) => metric.entries.length)
		.map((metric) => ({
			key: metric.key,
			label: metric.label,
			units: sortByUnit(metric.entries, (entry) => entry.uom).map((entry) => {
				const qty = Number(entry.qty || 0);
				return { qty, text: quantityText(metric, qty, entry.uom) };
			}),
		})),
);

function rowText(row: (typeof rows.value)[number]) {
	return `${row.label}：${row.units.map((unit) => unit.text).join("；")}`;
}

const fullText = computed(() => rows.value.map(rowText).join(" · "));

// Inline: `max` non-zero values. Every non-zero metric gets its first value before any
// metric shows a second unit, so no metric disappears behind the disclosure. When every
// value is zero, the first metric's first value keeps the line from being empty.
const inline = computed(() => {
	const withValues = rows.value
		.map((row) => ({ ...row, units: row.units.filter((unit) => unit.qty !== 0) }))
		.filter((row) => row.units.length);
	if (!withValues.length) {
		return rows.value.slice(0, 1).map((row) => ({
			key: row.key,
			text: `${row.label} ${row.units[0].text}`,
			count: 0,
		}));
	}
	const shown = withValues.map(() => 0);
	let remaining = props.max;
	for (let pass = 0; remaining > 0; pass++) {
		let added = false;
		withValues.forEach((row, index) => {
			if (remaining > 0 && shown[index] === pass && row.units.length > pass) {
				shown[index]++;
				remaining--;
				added = true;
			}
		});
		if (!added) break;
	}
	return withValues
		.map((row, index) => ({
			key: row.key,
			text: `${row.label} ${row.units
				.slice(0, shown[index])
				.map((unit) => unit.text)
				.join("；")}`,
			count: shown[index]!,
		}))
		.filter((value) => value.count);
});

const hiddenCount = computed(() => {
	const nonZero = rows.value.reduce(
		(total, row) => total + row.units.filter((unit) => unit.qty !== 0).length,
		0,
	);
	const visible = inline.value.reduce((total, value) => total + value.count, 0);
	return Math.max(0, nonZero - visible);
});
</script>

<template>
	<span
		v-if="fullText"
		class="group-totals"
		role="group"
		:aria-label="`${label}：${fullText}`"
		:title="fullText"
	>
		<template v-for="(value, index) in inline" :key="value.key">
			<span v-if="index" class="group-totals-separator" aria-hidden="true"> · </span>
			<span class="group-totals-value">{{ value.text }}</span>
		</template>
		<!-- The disclosure must not trigger a surrounding record link. -->
		<span v-if="hiddenCount" class="group-totals-more" @click.stop.prevent>
			<DetailPopover
				:label="fullText"
				trigger-class="operation-unit-more group-totals-trigger"
			>
				<template #trigger>+{{ hiddenCount }}</template>
				<ul>
					<li v-for="row in rows" :key="row.key">{{ rowText(row) }}</li>
				</ul>
			</DetailPopover>
		</span>
	</span>
</template>

<style scoped>
.group-totals {
	display: inline-flex;
	max-width: 100%;
	min-width: 0;
	flex-wrap: wrap;
	align-items: center;
	gap: 0 var(--p-space-1);
}
.group-totals-value {
	white-space: nowrap;
}
.group-totals-separator {
	white-space: pre;
}
.group-totals-more {
	display: inline-flex;
	align-items: center;
}
/* Touch targets are at least 44px; fine pointers keep the compact trigger. */
@media (pointer: coarse) {
	.group-totals :deep(.group-totals-trigger) {
		min-width: 44px;
		min-height: 44px;
		justify-content: center;
	}
}
</style>
