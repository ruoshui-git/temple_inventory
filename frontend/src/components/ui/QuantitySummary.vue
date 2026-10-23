<script setup lang="ts">
import InventoryIcon from "../InventoryIcon.vue";
import AsyncRegion from "./AsyncRegion.vue";
import SkeletonBlock from "./SkeletonBlock.vue";
import { formatQuantity } from "../../lib/formatQuantity";
export type Quantity = { uom: string; qty: number; status?: string; effect?: number };
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

function effect(quantity: Quantity) {
	return ["草稿", "已取消", "计划借出（草稿）"].includes(quantity.status || "")
		? 0
		: Number(quantity.effect || 0);
}
function effectLabel(quantity: Quantity) {
	const value = effect(quantity);
	return value > 0
		? `可用库存增加 ${formatQuantity(value)} ${quantity.uom}`
		: value < 0
			? `可用库存减少 ${formatQuantity(Math.abs(value))} ${quantity.uom}`
			: `可用库存不变 · ${quantity.uom}`;
}
</script>

<template>
	<AsyncRegion
		:loading="loading"
		:initialized="metrics.length > 0 || !loading"
		:stale="metrics.length > 0"
		label="数量结果刷新中。"
	>
		<template #skeleton
			><SkeletonBlock variant="lines" :count="Math.max(metrics.length, 2)"
		/></template>
		<section class="quantity-summary" :aria-label="label" :aria-busy="loading">
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
						<strong
							v-for="quantity in metric.quantities"
							:key="`${quantity.uom}:${quantity.status || ''}`"
							:class="
								quantity.effect === undefined
									? undefined
									: `stock-effect ${effect(quantity) > 0 ? 'is-increase' : effect(quantity) < 0 ? 'is-decrease' : 'is-neutral'}`
							"
							:title="
								quantity.effect === undefined ? undefined : effectLabel(quantity)
							"
						>
							{{ formatQuantity(quantity.qty) }} <span>{{ quantity.uom }}</span>
							<small v-if="quantity.status"> · {{ quantity.status }}</small>
							<span v-if="quantity.effect !== undefined" class="sr-only">{{
								effectLabel(quantity)
							}}</span>
						</strong>
					</div>
					<strong v-else-if="!loading" class="quantity-summary-empty">0</strong>
				</div>
			</article>
		</section>
	</AsyncRegion>
</template>

<style scoped>
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
.quantity-summary-values strong + strong::before {
	content: "";
	display: inline-block;
	block-size: 0.9em;
	border-inline-start: 1px solid var(--p-border);
	vertical-align: -0.08em;
	color: var(--p-muted);
	margin-inline-end: var(--p-space-3);
}
.quantity-summary-values span {
	font-weight: 400;
}
</style>
