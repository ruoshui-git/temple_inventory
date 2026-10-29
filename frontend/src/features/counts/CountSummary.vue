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
		<strong v-if="!compact">已核对 {{ summary.reviewed }} / {{ summary.total }} 行</strong>
		<span v-if="!compact">{{ summary.unreviewed }} 行未核对</span>
		<span v-if="!compact">账面合计：{{ quantities(summary.baseline) }}</span>
		<span v-if="!compact"
			>已核对实点合计：{{ summary.reviewed ? quantities(summary.actual) : "—" }}</span
		>
		<span>增加：{{ summary.reviewed ? quantities(summary.gains, true) : "—" }}</span>
		<span>减少：{{ summary.reviewed ? quantities(summary.losses, true) : "—" }}</span>
		<span title="增加与减少相抵后的净值">
			净差异：{{ summary.reviewed ? quantities(summary.difference, true) : "—" }}
		</span>
	</div>
</template>

<style scoped>
.count-summary-strip {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 6px 16px;
	padding: 9px 12px;
	border: 1px solid var(--p-border);
	border-radius: var(--p-radius-control);
	background: var(--p-soft);
}
.count-summary-strip span {
	color: var(--p-muted);
}
@media (max-width: 1023px) {
	.count-summary-strip {
		gap: 8px 12px;
	}
}
</style>
