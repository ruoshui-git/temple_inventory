<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
export type Quantity = { uom: string; qty: number };
export type QuantityMetric = {
	key: string;
	label: string;
	quantities: Quantity[];
	icon?: string;
	tone?: string;
};

withDefaults(defineProps<{ metrics: QuantityMetric[]; loading?: boolean; label?: string }>(), {
	loading: false,
	label: "数量汇总",
});

const formatQuantity = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
</script>

<template>
	<section class="quantity-summary" :aria-label="label" aria-live="polite" :aria-busy="loading">
		<p v-if="loading" class="quantity-summary-loading" role="status">
			正在更新…已有数量为上次结果。
		</p>
		<article
			v-for="metric in metrics"
			:key="metric.key"
			class="quantity-summary-metric"
			:class="metric.tone"
		>
			<span v-if="metric.icon" class="metric-icon" aria-hidden="true"
				><InventoryIcon :name="metric.icon"
			/></span>
			<div>
				<small>{{ metric.label }}</small>
				<div v-if="metric.quantities.length" class="quantity-summary-values">
					<strong v-for="quantity in metric.quantities" :key="quantity.uom">
						{{ formatQuantity(quantity.qty) }} <span>{{ quantity.uom }}</span>
					</strong>
				</div>
				<strong v-else-if="!loading" class="quantity-summary-empty">0</strong>
			</div>
		</article>
	</section>
</template>

<style scoped>
.quantity-summary-loading {
	grid-column: 1 / -1;
}
.quantity-summary-values {
	display: flex;
	flex-wrap: wrap;
	column-gap: var(--p-space-3);
	row-gap: 0;
}
.quantity-summary-values strong {
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}
.quantity-summary-values span {
	font-weight: 400;
}
</style>
