<script setup lang="ts">
export type Quantity = { uom: string; qty: number };
export type QuantityMetric = { key: string; label: string; quantities: Quantity[] };

withDefaults(defineProps<{ metrics: QuantityMetric[]; loading?: boolean; label?: string }>(), {
	loading: false,
	label: "数量汇总",
});

const formatQuantity = (value: number) =>
	new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(Number(value || 0));
</script>

<template>
	<section class="quantity-summary" :aria-label="label" aria-live="polite" :aria-busy="loading">
		<article v-for="metric in metrics" :key="metric.key" class="quantity-summary-metric">
			<small>{{ metric.label }}</small>
			<div v-if="loading" class="quantity-summary-loading">正在更新…</div>
			<div v-else-if="metric.quantities.length" class="quantity-summary-values">
				<strong v-for="quantity in metric.quantities" :key="quantity.uom">
					{{ formatQuantity(quantity.qty) }} <span>{{ quantity.uom }}</span>
				</strong>
			</div>
			<strong v-else class="quantity-summary-empty">0</strong>
		</article>
	</section>
</template>

<style scoped>
.quantity-summary {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
	gap: 8px;
	padding: 10px 0;
}
.quantity-summary-metric {
	min-width: 0;
	padding: 10px 12px;
	border: 1px solid #e5ddcf;
	border-radius: 12px;
	background: #fffaf2;
}
.quantity-summary-metric small {
	display: block;
	margin-bottom: 4px;
	color: #725f4b;
}
.quantity-summary-values {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 10px;
}
.quantity-summary-values strong {
	white-space: nowrap;
}
.quantity-summary-values span,
.quantity-summary-empty,
.quantity-summary-loading {
	color: #6f655a;
}
@media (max-width: 640px) {
	.quantity-summary {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
