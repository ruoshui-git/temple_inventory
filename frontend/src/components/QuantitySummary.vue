<script setup lang="ts">
import InventoryIcon from "./InventoryIcon.vue";
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
	gap: var(--ti-space-2);
	padding: var(--ti-space-2) 0 0;
}
.quantity-summary-metric {
	display: flex;
	align-items: center;
	gap: var(--ti-space-2);
	min-width: 0;
	padding: var(--ti-space-2) var(--ti-space-3);
	border: 1px solid var(--ti-border);
	border-radius: var(--ti-radius-control);
	background: var(--ti-surface);
}
.quantity-summary-metric > div {
	min-width: 0;
}
.metric-icon {
	display: grid;
	width: 29px;
	height: 29px;
	flex: none;
	border-radius: 50%;
	background: var(--ti-accent-soft);
	place-items: center;
}
.metric-icon :deep(svg) {
	width: 18px;
	height: 18px;
}
.quantity-summary-metric.available {
	color: var(--ti-success);
}
.quantity-summary-metric.total {
	color: var(--ti-muted);
}
.quantity-summary-metric.loaned {
	color: var(--ti-warning);
}
.quantity-summary-metric.damaged {
	color: var(--ti-danger);
}
.quantity-summary-metric small {
	display: block;
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
}
.quantity-summary-values {
	display: flex;
	flex-wrap: wrap;
	column-gap: var(--ti-space-3);
	row-gap: 0;
}
.quantity-summary-values strong {
	white-space: nowrap;
	font-size: var(--ti-font-section);
	font-variant-numeric: tabular-nums;
}
.quantity-summary-values span {
	color: var(--ti-muted);
	font-size: var(--ti-font-small);
	font-weight: 400;
}
.quantity-summary-empty,
.quantity-summary-loading {
	color: var(--ti-muted);
}
@media (max-width: 640px) {
	.quantity-summary {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
