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
			<span class="metric-icon" aria-hidden="true"></span>
			<div>
				<small>{{ metric.label }}</small>
				<div v-if="loading" class="quantity-summary-loading">正在更新…</div>
				<div v-else-if="metric.quantities.length" class="quantity-summary-values">
					<strong v-for="quantity in metric.quantities" :key="quantity.uom">
						{{ formatQuantity(quantity.qty) }} <span>{{ quantity.uom }}</span>
					</strong>
				</div>
				<strong v-else class="quantity-summary-empty">0</strong>
			</div>
		</article>
	</section>
</template>

<style scoped>
.quantity-summary {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 9px;
	padding: 10px 0 0;
}
.quantity-summary-metric {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	padding: 8px 12px;
	border: 1px solid #ece9e2;
	border-radius: 7px;
	background: #fff;
}
.quantity-summary-metric > div {
	min-width: 0;
}
.metric-icon {
	width: 29px;
	height: 29px;
	flex: none;
	border-radius: 50%;
	background: #f2f5f3;
}
.quantity-summary-metric small {
	display: block;
	color: #6c747a;
	font-size: 12px;
}
.quantity-summary-values {
	display: flex;
	flex-wrap: wrap;
	column-gap: 12px;
	row-gap: 0;
}
.quantity-summary-values strong {
	white-space: nowrap;
	font-size: 17px;
	font-variant-numeric: tabular-nums;
}
.quantity-summary-values span {
	color: #7b807c;
	font-size: 11px;
	font-weight: 400;
}
.quantity-summary-empty,
.quantity-summary-loading {
	color: #7b807c;
}
@media (max-width: 640px) {
	.quantity-summary {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
