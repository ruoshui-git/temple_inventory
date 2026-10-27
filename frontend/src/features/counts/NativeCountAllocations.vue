<script setup lang="ts">
import { unitLabel } from "../../lib/units";
import { computed } from "vue";
const props = defineProps<{ row: Record<string, unknown> }>();
interface Allocation {
	batch_no: string;
	baseline_qty: number;
	actual_qty: number;
	difference: number;
}
const allocations = computed(
	() =>
		(Array.isArray(props.row.recorded_count_allocations)
			? props.row.recorded_count_allocations
			: []) as Allocation[],
);
</script>
<template>
	<div v-if="allocations.some((allocation) => allocation.batch_no)">
		<p class="muted">已保存的批次明细</p>
		<dl>
			<template v-for="allocation in allocations" :key="allocation.batch_no">
				<dt>{{ allocation.batch_no || "无批次" }}</dt>
				<dd>
					账面 {{ allocation.baseline_qty }} · 实点 {{ allocation.actual_qty }} · 差异
					{{ allocation.difference }} {{ unitLabel(row.stock_uom) }}
				</dd>
			</template>
		</dl>
	</div>
</template>
