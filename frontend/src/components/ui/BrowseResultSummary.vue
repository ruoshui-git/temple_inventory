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
		metric.quantities.map(
			(quantity) => `${metric.label} ${formatQuantity(quantity.qty)} ${quantity.uom}`,
		),
	),
);
const preview = computed(() => [
	...entries.value.slice(0, 2),
	...(entries.value.length > 2 ? [`+${entries.value.length - 2} 单位`] : []),
]);
const mobilePreview = computed(() => [
	...entries.value.slice(0, 1),
	...(entries.value.length > 1 ? [`+${entries.value.length - 1} 单位`] : []),
]);
const accessibleSummary = computed(() => `${props.label}，${entries.value.join("，")}，数量分析`);
</script>

<template>
	<div class="browse-summary-line">
		<div class="browse-summary-copy">
			<strong class="browse-result-summary-label">{{ label }}</strong>
			<details class="browse-result-summary">
				<summary :aria-label="accessibleSummary">
					<span
						v-for="(entry, index) in preview"
						:key="entry"
						class="browse-result-summary-item"
						:class="{
							'browse-result-summary-item--detail':
								index > 0 && index < preview.length - 1,
						}"
					>
						{{ entry
						}}<span v-if="index < preview.length - 1" aria-hidden="true"> · </span>
					</span>
					<span
						v-for="(entry, index) in mobilePreview"
						:key="`mobile:${entry}`"
						class="browse-result-summary-mobile-item"
					>
						{{ entry
						}}<span v-if="index < mobilePreview.length - 1" aria-hidden="true">
							·
						</span>
						<span
							v-if="index === mobilePreview.length - 1 && mobilePreview.length > 1"
							class="browse-result-summary-mobile-disclosure"
							aria-hidden="true"
							>▸</span
						>
					</span>
					<span class="browse-result-summary-disclosure" aria-hidden="true">▸</span>
				</summary>
				<QuantitySummary :metrics="metrics" :loading="loading" />
			</details>
		</div>
		<div v-if="$slots.controls" class="browse-summary-controls"><slot name="controls" /></div>
	</div>
</template>
