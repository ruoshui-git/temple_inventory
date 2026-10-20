<script setup lang="ts">
import { computed } from "vue";
import { countSummary } from "./countModel";
import type { CountRow } from "./countModel";
const props = defineProps<{ rows: CountRow[] }>();
const summary = computed(() => countSummary(props.rows));
function quantities(values: [string, number][], signed = false) {
	return (
		values.map(([unit, qty]) => `${signed && qty > 0 ? "+" : ""}${qty} ${unit}`).join(" · ") ||
		"—"
	);
}
</script>

<template>
	<div class="count-summary-strip" role="status">
		<strong>已核对 {{ summary.reviewed }} / {{ summary.total }} 行</strong>
		<span>{{ summary.unreviewed }} 行未核对</span>
		<span>账面合计：{{ quantities(summary.baseline) }}</span>
		<span>已核对实点合计：{{ summary.reviewed ? quantities(summary.actual) : "—" }}</span>
		<span
			>本次调整差异：{{
				summary.reviewed ? quantities(summary.difference, true) : "—"
			}}</span
		>
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
