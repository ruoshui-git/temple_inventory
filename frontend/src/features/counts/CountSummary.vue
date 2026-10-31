<script setup lang="ts">
import { computed } from "vue";
import { countSummary } from "./countModel";
import type { CountRow } from "./countModel";
import { formatQuantityWithUnit } from "../../lib/formatQuantity";
const props = defineProps<{ rows: CountRow[]; compact?: boolean }>();
const summary = computed(() => countSummary(props.rows));
function quantities(values: [string, number][], signed = false) {
	return (
		values
			.map(
				([unit, qty]) =>
					`${signed && qty > 0 ? "+" : qty < 0 ? "−" : ""}${formatQuantityWithUnit(Math.abs(qty), unit)}`,
			)
			.join(" · ") || "—"
	);
}
</script>

<template>
	<div class="count-summary-strip" role="status">
		<article v-if="!compact" class="metric">
			<small>核对物品数</small><strong>{{ summary.reviewed }} / {{ summary.total }}</strong>
		</article>
		<article v-if="!compact && summary.unreviewed" class="metric">
			<small>未核对</small><strong>{{ summary.unreviewed }} 行未核对</strong>
		</article>
		<article v-if="!compact" class="metric">
			<small>有差异物品数</small><strong>{{ summary.changed }}</strong>
		</article>
		<article class="metric" :class="{ 'is-increase': summary.gains.some(([, qty]) => qty) }">
			<small>增加</small
			><strong>{{ summary.reviewed ? quantities(summary.gains, true) : "—" }}</strong>
		</article>
		<article class="metric" :class="{ 'is-decrease': summary.losses.some(([, qty]) => qty) }">
			<small>减少</small
			><strong>{{ summary.reviewed ? quantities(summary.losses, true) : "—" }}</strong>
		</article>
		<article
			class="metric is-net"
			:class="
				summary.difference.some(([, qty]) => qty > 0)
					? 'is-increase'
					: summary.difference.some(([, qty]) => qty < 0)
						? 'is-decrease'
						: ''
			"
		>
			<small>净差异</small
			><strong>{{ summary.reviewed ? quantities(summary.difference, true) : "—" }}</strong>
		</article>
	</div>
</template>

<style scoped>
.count-summary-strip {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: 8px;
}
.metric {
	min-width: 0;
	padding: 12px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-surface);
}
.metric small,
.metric strong {
	display: block;
}
.metric small {
	color: var(--p-muted);
}
.metric strong {
	margin-top: 4px;
	font-variant-numeric: tabular-nums;
}
.metric.is-increase strong {
	color: var(--p-success);
}
.metric.is-decrease strong {
	color: var(--p-danger);
}
@media (max-width: 1023px) {
	.count-summary-strip {
		gap: 8px 12px;
	}
}
</style>
