<script setup lang="ts">
import { computed } from "vue";
import type { CountRow } from "./countModel";
import { countSummary } from "./countModel";
const props = defineProps<{ rows: CountRow[]; location?: string }>();
const summary = computed(() => countSummary(props.rows));
function quantities(values: [string, number][], signed = false) {
	return (
		values
			.map(
				([unit, qty]) =>
					`${signed && qty < 0 ? "−" : signed && qty > 0 ? "+" : ""}${signed ? Math.abs(qty) : qty} ${unit}`,
			)
			.join(" · ") || "—"
	);
}
</script>
<template>
	<div class="preview-count-summary">
		<p class="count-summary-location">
			盘点库位：{{ location || rows[0]?.warehouse || "待选择" }}
		</p>
		<p class="count-summary-progress" role="status">
			已核对 {{ summary.reviewed }} / {{ summary.total }} 行 ·
			{{ summary.unreviewed }} 行未核对，不纳入调整
		</p>
		<dl>
			<div class="count-baseline">
				<dt>账面合计</dt>
				<dd>{{ quantities(summary.baseline) }}</dd>
			</div>
			<div class="count-actual">
				<dt>已核对实点合计</dt>
				<dd>{{ summary.reviewed ? quantities(summary.actual) : "尚未核对" }}</dd>
			</div>
			<div class="count-difference">
				<dt>本次调整差异</dt>
				<dd>{{ summary.reviewed ? quantities(summary.difference, true) : "尚未核对" }}</dd>
			</div>
		</dl>
	</div>
</template>
