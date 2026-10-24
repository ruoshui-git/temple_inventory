<script setup lang="ts">
import { computed } from "vue";
import { formatQuantity } from "../../lib/formatQuantity";
import QuantitySummary, { type QuantityMetric } from "./QuantitySummary.vue";
const props = defineProps<{
	label: string;
	metrics: QuantityMetric[];
	loading?: boolean;
}>();
const entries = computed(() =>
	props.metrics.flatMap((metric) =>
		metric.quantities.map((quantity) => `${metric.label} ${formatQuantity(quantity.qty)} ${quantity.uom}`),
	),
);
const preview = computed(() => [
	...entries.value.slice(0, 2),
	...(entries.value.length > 2 ? [`+${entries.value.length - 2} 单位`] : []),
]);
</script>

<template>
	<details class="browse-result-summary">
		<summary :aria-label="`${label}，数量分析`">
			<strong>{{ label }}</strong>
			<span v-for="(entry, index) in preview" :key="entry" class="browse-result-summary-item">
				{{ entry }}<span v-if="index < preview.length - 1" aria-hidden="true"> · </span>
			</span>
			<span class="browse-result-summary-disclosure" aria-hidden="true">▸</span>
		</summary>
		<QuantitySummary :metrics="metrics" :loading="loading" />
	</details>
</template>
