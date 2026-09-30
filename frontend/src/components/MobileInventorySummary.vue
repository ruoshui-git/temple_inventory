pyenv: cannot rehash: /home/frappe/.pyenv/shims isn't writable rm: cannot remove
'/home/frappe/.nvm/current': Read-only file system
<script setup lang="ts">
export interface MobileSummaryMetric {
	key: string;
	label: string;
	overall: number;
	tone: "available" | "total" | "warning" | "danger";
	details: Array<{ label: string; value: number; uom?: string }>;
}

defineProps<{ metrics: MobileSummaryMetric[]; expandedKey?: string }>();
const emit = defineEmits<{ select: [key: string] }>();
const format = (value: number) => value.toLocaleString("zh-CN");
</script>

<template>
	<section class="mobile-summary" aria-label="筛选结果汇总">
		<div class="mobile-summary-row">
			<button
				v-for="metric in metrics"
				:key="metric.key"
				type="button"
				class="mobile-summary-card"
				:class="[metric.tone, { selected: expandedKey === metric.key }]"
				:aria-expanded="expandedKey === metric.key"
				@click="emit('select', metric.key)"
			>
				<small>{{ metric.label }}</small>
				<strong>{{ format(metric.overall) }}</strong>
			</button>
		</div>
		<div
			v-if="expandedKey"
			class="mobile-summary-details"
			:class="metrics.find((metric) => metric.key === expandedKey)?.tone"
		>
			<b>{{ metrics.find((metric) => metric.key === expandedKey)?.label }}数量明细</b>
			<div>
				<span
					v-for="detail in metrics.find((metric) => metric.key === expandedKey)?.details"
					:key="detail.label"
				>
					<strong>{{ format(detail.value) }}</strong>
					<small>{{ detail.uom || detail.label }}</small>
				</span>
			</div>
		</div>
	</section>
</template>

<style scoped>
.mobile-summary {
	display: grid;
	gap: 6px;
}
.mobile-summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
	gap: 5px;
}
.mobile-summary-card {
	display: flex;
	min-width: 0;
	min-height: 70px;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	padding: 8px 7px;
	border: 1px solid #e8e4dc;
	border-radius: 8px;
	background: #fff;
	color: #29333f;
	text-align: left;
}
.mobile-summary-card small {
	color: #657079;
	font-size: 11px;
}
.mobile-summary-card strong {
	font-size: 18px;
	line-height: 1.25;
	font-variant-numeric: tabular-nums;
}
.mobile-summary-card.available {
	background: #f0f8f3;
	color: #0e7d4b;
}
.mobile-summary-card.warning {
	background: #fff7ed;
	color: #b65a17;
}
.mobile-summary-card.danger {
	background: #fff1ef;
	color: #bd3f37;
}
.mobile-summary-card.selected {
	border-color: currentColor;
	box-shadow: inset 0 -2px currentColor;
}
.mobile-summary-details {
	padding: 9px 10px;
	border: 1px solid #b9dcca;
	border-radius: 8px;
	background: #f2faf5;
}
.mobile-summary-details.warning {
	border-color: #edd1ad;
	background: #fff8ef;
}
.mobile-summary-details.danger {
	border-color: #efc5c0;
	background: #fff4f2;
}
.mobile-summary-details > b {
	display: block;
	margin-bottom: 7px;
	font-size: 11px;
	font-weight: 550;
}
.mobile-summary-details > div {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
}
.mobile-summary-details span {
	display: flex;
	flex-direction: column;
	align-items: center;
	border-right: 1px solid #dbe7df;
}
.mobile-summary-details span:last-child {
	border: 0;
}
.mobile-summary-details strong {
	font-size: 16px;
}
.mobile-summary-details small {
	color: #657079;
	font-size: 10px;
}
</style>
