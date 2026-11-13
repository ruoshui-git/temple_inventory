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
interface SerialAllocation {
	baseline_serials: string[];
	actual_serials: string[];
	missing_serials: string[];
	found_serials: string[];
}
const allocations = computed(
	() =>
		(Array.isArray(props.row.recorded_count_allocations)
			? props.row.recorded_count_allocations
			: []) as Allocation[],
);
const serialAllocations = computed(
	() =>
		(Array.isArray(props.row.recorded_count_serial_allocations)
			? props.row.recorded_count_serial_allocations
			: []) as SerialAllocation[],
);
</script>
<template>
	<div v-if="allocations.some((allocation) => allocation.batch_no)">
		<p class="muted">已保存的批次明细</p>
		<dl class="count-allocation-detail-grid">
			<template v-for="allocation in allocations" :key="allocation.batch_no">
				<dt>{{ allocation.batch_no || "无批次" }}</dt>
				<dd>
					账面 {{ allocation.baseline_qty }} · 实点 {{ allocation.actual_qty }} · 差异
					{{ allocation.difference }} {{ unitLabel(row.stock_uom) }}
				</dd>
			</template>
		</dl>
	</div>
	<div v-if="serialAllocations.length" class="count-serial-detail">
		<p class="muted">已保存的序列号明细</p>
		<template v-for="(allocation, index) in serialAllocations" :key="index">
			<details v-if="allocation.missing_serials.length || allocation.found_serials.length">
				<summary>
					账面 {{ allocation.baseline_serials.length }} · 实点
					{{ allocation.actual_serials.length }} ·
					{{
						allocation.missing_serials.length
							? `缺少 ${allocation.missing_serials.length}`
							: ""
					}}
					{{
						allocation.found_serials.length
							? `多出 ${allocation.found_serials.length}`
							: ""
					}}
				</summary>
				<p>账面：{{ allocation.baseline_serials.join("、") || "无" }}</p>
				<p>实点：{{ allocation.actual_serials.join("、") || "无" }}</p>
				<p v-if="allocation.missing_serials.length">
					缺少：{{ allocation.missing_serials.join("、") }}
				</p>
				<p v-if="allocation.found_serials.length">
					多出：{{ allocation.found_serials.join("、") }}
				</p>
			</details>
			<p v-else>序列号一致</p>
		</template>
	</div>
</template>

<style scoped>
.count-serial-detail {
	display: block;
	width: min(320px, 100%);
	max-width: 100%;
	white-space: normal;
	overflow-wrap: anywhere;
	font-size: var(--p-small);
}
.count-serial-detail p {
	margin: var(--p-field-gap) 0;
	white-space: normal;
	overflow-wrap: anywhere;
}
</style>
